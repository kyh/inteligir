// OpenNote store — the HIGH-CADENCE slice of the vault workspace.
//
// The open note's exposed state (editor snapshot, derived OpenDoc) changes on
// every keystroke (Raw) / serialize settle (Rich) / autosave `saving` flip. Carrying that in the VaultContext value
// re-renders ALL of its consumers per keystroke; a zustand store lets each
// consumer subscribe to exactly the field it reads
// (`useOpenNote((s) => s.editor.path)`), so typing re-renders only the editor.
//
// Division of labor: the VaultProvider PRODUCES everything — it owns the
// note runtime (controller + autosave debounce + vanish watcher) and its
// open/rename/delete ordering — and drives this store synchronously through
// the publish* functions below. The store owns EXPOSURE plus the derivations
// over it (gate analysis, deriveOpenDoc), keeping them out of the provider's
// render. Publishing is synchronous with the controller's emission so
// a controlled textarea's value updates in the same event flush as the
// keystroke (an effect-time mirror would let React "restore" the input first).

import { createStore, type StoreApi } from "zustand/vanilla";

import { toast } from "@repo/ui/components/sonner";

import {
  type GateReason,
  describeGateReason,
  safeGateReason,
} from "@repo/editor/note/markdown-gate";
import type { VaultEditorState } from "@repo/editor/vault-editor";
import { type OpenDoc, deriveOpenDoc, isMarkdownPath } from "@repo/editor/note/open-doc";

/** The `editor` snapshot exposed while no note is open. */
const NO_NOTE_STATE: VaultEditorState = {
  root: "",
  path: null,
  content: "",
  dirty: false,
  saving: false,
};

/** The last SAVED-content gate verdict, keyed to the (path, content) it was
 * computed for — analysis lags typing on purpose (one pass per saved change,
 * not per keystroke). */
type Analyzed = {
  rawReason: GateReason | null;
  content: string;
  path: string | null;
};

export type OpenNoteState = {
  /** The note the UI intends open (the provider's openPathRef, mirrored). */
  openPath: string | null;
  /** Live editor session state of the open note (file, content, dirty,
   * saving). `NO_NOTE_STATE` when no note is open. */
  editor: VaultEditorState;
  /** Gate verdict for the last analyzed saved content (see Analyzed). */
  analyzed: Analyzed;
  /** The open document as ONE discriminated union — derived in lockstep with
   * (openPath, editor, analysis) inside every store update, so it can never
   * disagree with the values it came from. */
  openDoc: OpenDoc;
  /** Where the user has been, newest LAST. `back.at(-1)` is what Back opens. */
  back: string[];
  /** Where Back came from, newest LAST. Cleared by any fresh navigation. */
  forward: string[];
  /**
   * Persist the live buffer, installed by the session that owns it.
   *
   * An ACTION rather than state, but it lives here because it is scoped to
   * exactly the note this store describes: a session ending clears it with
   * everything else, so no separate teardown can forget to. `null` means no
   * session is mounted, which ./open-note-flush reads as "nothing to flush".
   */
  flush: (() => Promise<boolean>) | null;
};

const INITIAL_ANALYZED: Analyzed = { rawReason: null, content: "", path: null };

const INITIAL_STATE: OpenNoteState = {
  openPath: null,
  editor: NO_NOTE_STATE,
  analyzed: INITIAL_ANALYZED,
  openDoc: { kind: "none" },
  back: [],
  forward: [],
  flush: null,
};

/** Deepest history either direction keeps. A workspace open for a week would
 * otherwise accumulate one entry per note opened, forever. */
const HISTORY_DEPTH = 50;

function capped(stack: readonly string[]): string[] {
  return stack.length > HISTORY_DEPTH ? stack.slice(stack.length - HISTORY_DEPTH) : [...stack];
}

/**
 * One open note's state machine, INSTANCE-scoped. Everything below closes over
 * this instance's zustand store and its own pending-analysis token; nothing is
 * module state, so an ended session's in-flight analysis cannot publish into
 * the next one's. React consumers reach an instance through
 * ./open-note-context (`useOpenNote(selector)`); non-React callers hold the
 * object the workspace created.
 */
export type OpenNoteStore = {
  /** The raw store, for `useStore(store, selector)` subscriptions. */
  readonly store: StoreApi<OpenNoteState>;
  /** Imperative live read for action-time consumers. Always the CURRENT
   * value — never capture the result across awaits. */
  state: () => OpenNoteState;
  publishEditor: (editor: VaultEditorState) => void;
  publishOpenPath: (path: string | null, change?: OpenPathChange) => void;
  /** Wire (or clear, with null) the live session's flush. The session owns
   * the only implementation. */
  setFlush: (flush: (() => Promise<boolean>) | null) => void;
};

/**
 * How the open path moved, for history's sake.
 * - `navigate`: somebody chose this note (a click, a wiki chip, a deep link,
 *   Back or Forward, or closing the note). The stacks record it.
 * - `carry`: a RENAME moved the note that was already open. Nothing was
 *   navigated, and the old path no longer exists — so every entry naming it is
 *   rewritten rather than a new one pushed. Without this, Back would offer a
 *   path the rename deleted.
 */
export type OpenPathChange = "navigate" | "carry";

export function createOpenNoteStore(): OpenNoteStore {
  const store = createStore<OpenNoteState>()(() => INITIAL_STATE);

  /** Merge a partial update and recompute the derived fields in the same set,
   * keeping `openDoc` referentially stable when none of its inputs changed, so
   * a consumer selecting it doesn't re-render on unrelated updates. */
  function apply(partial: Partial<Pick<OpenNoteState, "openPath" | "editor" | "analyzed">>): void {
    store.setState((s) => {
      const merged = { ...s, ...partial };
      const sameDocInputs =
        merged.openPath === s.openPath &&
        merged.editor.path === s.editor.path &&
        merged.analyzed.rawReason === s.analyzed.rawReason;
      merged.openDoc = sameDocInputs
        ? s.openDoc
        : deriveOpenDoc({
            openPath: merged.openPath,
            loadedPath: merged.editor.path,
            rawReason: merged.analyzed.rawReason,
          });
      return merged;
    });
  }

  // Pending deferred same-path analysis target — the microtask's identity check
  // (superseded by newer content or cancelled by a path change, both
  // replace/null this).
  let pendingAnalysis: { path: string | null; content: string } | null = null;

  /**
   * Publish a controller emission (provider-only). Runs the gate-analysis state
   * machine — timing is SPLIT by what's at stake:
   * - Path change: analyzed synchronously WITH the editor update (one setState),
   *   so the gate and the content can never disagree — a freshly opened
   *   Raw-only file must never mount the rich editor against unparseable bytes.
   * - Same-path content change (every 600ms autosave settle): deferred to a
   *   microtask (bounded latency; analyzeMarkdown is a full Slate construct +
   *   remark parse + serialize, up to 3 passes — running it synchronously
   *   blocks every autosave commit). The accepted window is one frame at most:
   *   the note is ALREADY rendered with the prior verdict for the same path.
   *   The microtask rechecks path+content against the LIVE store state before
   *   applying and drops itself when superseded or cancelled.
   * While the buffer is dirty (mid-typing, pre-autosave) the last analysis is
   * intentionally retained — one analysis pass per SAVED content change.
   */
  function publishEditor(editor: VaultEditorState): void {
    const s = store.getState();
    const isMarkdownOpen = editor.path !== null && isMarkdownPath(editor.path);
    const pathChanged = s.analyzed.path !== editor.path;
    if ((pathChanged || s.analyzed.content !== editor.content) && !editor.dirty) {
      if (pathChanged) {
        pendingAnalysis = null; // cancel any deferred same-path pass
        const rawReason =
          isMarkdownOpen && editor.content.trim() !== "" ? safeGateReason(editor.content) : null;
        apply({
          editor,
          analyzed: { rawReason, content: editor.content, path: editor.path },
        });
        return;
      }
      const pending = pendingAnalysis;
      if (pending === null || pending.path !== editor.path || pending.content !== editor.content) {
        const target = { path: editor.path, content: editor.content };
        pendingAnalysis = target;
        queueMicrotask(() => {
          // Identity check: superseded by newer content or cancelled by a path
          // change (both replace/null pendingAnalysis) → this pass is stale.
          if (pendingAnalysis !== target) return;
          pendingAnalysis = null;
          // LIVE store read — never the snapshot captured at schedule time.
          const live = store.getState();
          if (
            live.editor.path !== target.path ||
            live.editor.content !== target.content ||
            live.editor.dirty
          ) {
            return;
          }
          const markdownOpen = target.path !== null && isMarkdownPath(target.path);
          const rawReason =
            markdownOpen && target.content.trim() !== "" ? safeGateReason(target.content) : null;
          // A mid-session Rich→Raw flip (post-save re-analysis caught a
          // serializer bug, or an external reload landed unrepresentable
          // content) swaps Plate for the textarea under the user's cursor —
          // explain the yank once. Fresh opens (the path-change branch above)
          // don't toast: the file opens straight into the textarea.
          if (
            live.analyzed.path === target.path &&
            live.analyzed.rawReason === null &&
            rawReason !== null
          ) {
            toast.warning(`Switched to Raw editing — ${describeGateReason(rawReason)}`);
          }
          apply({ analyzed: { rawReason, content: target.content, path: target.path } });
        });
      }
    }
    apply({ editor });
  }

  /** Publish the intent path (provider-only, from applyOpenPath). Closing (null)
   * also resets the editor snapshot through the analysis machine so analyzed/mode
   * clear exactly as they did when the NO_NOTE state flowed through the
   * provider's render. */
  function publishOpenPath(path: string | null, change: OpenPathChange = "navigate"): void {
    const state = store.getState();
    const prev = state.openPath;
    if (prev !== path) {
      store.setState(
        change === "carry"
          ? {
              back: state.back.map((entry) => (entry === prev && path !== null ? path : entry)),
              forward: state.forward.map((entry) =>
                entry === prev && path !== null ? path : entry,
              ),
            }
          : movedHistory(state, prev, path),
      );
    }
    apply({ openPath: path });
    if (path === null) publishEditor(NO_NOTE_STATE);
  }

  return {
    store,
    state: () => store.getState(),
    publishEditor,
    publishOpenPath,
    setFlush: (flush) => {
      store.setState({ flush });
    },
  };
}

/** The stacks after a navigation from `prev` to `next`.
 *
 * A Back or Forward move is recognized by VALUE — `next` is already the top of
 * one stack — rather than by a flag the caller sets. That matters because the
 * navigation is async and refusable (an unsaved note blocks the switch): a flag
 * armed before the open would survive a refusal and mis-attribute the NEXT one,
 * while a stack that only moves when the path actually changed cannot.
 */
function movedHistory(
  state: OpenNoteState,
  prev: string | null,
  next: string | null,
): Pick<OpenNoteState, "back" | "forward"> {
  const carriedForward = prev === null ? state.forward : [...state.forward, prev];
  const carriedBack = prev === null ? state.back : [...state.back, prev];
  if (next !== null && state.back.at(-1) === next) {
    return { back: state.back.slice(0, -1), forward: capped(carriedForward) };
  }
  if (next !== null && state.forward.at(-1) === next) {
    return { back: capped(carriedBack), forward: state.forward.slice(0, -1) };
  }
  return { back: capped(carriedBack), forward: [] };
}

/** The note Back would open, or null when there is nowhere to go. Forward's
 * twin is `forward.at(-1)`. Both are plain reads — the MOVE is the ordinary
 * `openFile` on that path, which publishes and lets `movedHistory` recognize
 * it. */
export function backTarget(state: OpenNoteState): string | null {
  return state.back.at(-1) ?? null;
}

export function forwardTarget(state: OpenNoteState): string | null {
  return state.forward.at(-1) ?? null;
}
