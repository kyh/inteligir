// OpenNote store — the HIGH-CADENCE slice of the vault workspace.
//
// The open note's exposed state (editor snapshot, derived OpenDoc, raw/rich
// mode) changes on every keystroke (Raw) / serialize settle
// (Rich) / autosave `saving` flip. Carrying that in the VaultContext value
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

import { create } from "zustand";

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
  /** The user's raw/rich pick for the open note (honored only while rich is
   * available — deriveOpenDoc exposes the EFFECTIVE surface). */
  mode: "raw" | "rich";
  /** The open document as ONE discriminated union — derived in lockstep with
   * (openPath, editor, analysis, mode) inside every store update, so it can
   * never disagree with the values it came from. */
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
  mode: "raw",
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

/** Subscribe to a slice of the open-note state: `useOpenNote((s) => s.mode)`.
 * A consumer re-renders only when ITS selected value changes — the seam that
 * keeps a keystroke from re-rendering the whole app. */
export const useOpenNote = create<OpenNoteState>()(() => INITIAL_STATE);

/** Imperative live read for action-time consumers (e.g. the palette's
 * private-toggle reads `editor.content` at click time instead of subscribing
 * to every keystroke). Always the CURRENT value — never capture the result
 * across awaits. */
export function openNoteState(): OpenNoteState {
  return useOpenNote.getState();
}

/** Merge a partial update and recompute the derived fields in the same set,
 * keeping `openDoc` referentially stable when none of its inputs changed, so
 * a consumer selecting it doesn't re-render on unrelated updates. */
function apply(
  partial: Partial<Pick<OpenNoteState, "openPath" | "editor" | "analyzed" | "mode">>,
): void {
  useOpenNote.setState((s) => {
    const merged = { ...s, ...partial };
    const sameDocInputs =
      merged.openPath === s.openPath &&
      merged.editor.path === s.editor.path &&
      merged.editor.content === s.editor.content &&
      merged.analyzed.rawReason === s.analyzed.rawReason &&
      merged.mode === s.mode;
    merged.openDoc = sameDocInputs
      ? s.openDoc
      : deriveOpenDoc({
          openPath: merged.openPath,
          loadedPath: merged.editor.path,
          content: merged.editor.content,
          rawReason: merged.analyzed.rawReason,
          chosenMode: merged.mode,
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
 *   The mode (raw/rich) is the user's choice, picked once per file open — a
 *   post-save flush (dirty→false, content unchanged) and an external/agent
 *   reload of the same file must not yank the user out of the surface they
 *   picked. (deriveOpenDoc shows rich only while the gate is clear, so a file
 *   that turns unparseable out from under us still falls back to raw.)
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
export function publishEditor(editor: VaultEditorState): void {
  const s = useOpenNote.getState();
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
        mode: isMarkdownOpen && rawReason === null ? "rich" : "raw",
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
        const live = useOpenNote.getState();
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
        // don't toast: the badge covers them.
        if (
          live.analyzed.path === target.path &&
          live.analyzed.rawReason === null &&
          rawReason !== null &&
          live.mode === "rich"
        ) {
          toast.warning(`Switched to Raw editing — ${describeGateReason(rawReason)}`);
        }
        apply({ analyzed: { rawReason, content: target.content, path: target.path } });
      });
    }
  }
  apply({ editor });
}

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

/** Publish the intent path (provider-only, from applyOpenPath). Closing (null)
 * also resets the editor snapshot through the analysis machine so analyzed/mode
 * clear exactly as they did when the NO_NOTE state flowed through the
 * provider's render. */
export function publishOpenPath(path: string | null, change: OpenPathChange = "navigate"): void {
  const state = useOpenNote.getState();
  const prev = state.openPath;
  if (prev !== path) {
    useOpenNote.setState(
      change === "carry"
        ? {
            back: state.back.map((entry) => (entry === prev && path !== null ? path : entry)),
            forward: state.forward.map((entry) => (entry === prev && path !== null ? path : entry)),
          }
        : movedHistory(state, prev, path),
    );
  }
  apply({ openPath: path });
  if (path === null) publishEditor(NO_NOTE_STATE);
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

/** The user's raw/rich pick for a rich-capable markdown note (header toggle). */
export function setOpenNoteMode(mode: "raw" | "rich"): void {
  apply({ mode });
}
