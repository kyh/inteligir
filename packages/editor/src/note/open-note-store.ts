// a zustand store rather than VaultContext state: the editor snapshot changes per
// keystroke and context would re-render every consumer. publishing is synchronous
// with the controller's emission so a controlled textarea updates in the same
// flush as the keystroke; an effect-time mirror lets React restore the input first.

import { createStore, type StoreApi } from "zustand/vanilla";

import { toast } from "@repo/ui/components/sonner";

import {
  type GateReason,
  describeGateReason,
  safeGateReason,
} from "@repo/editor/note/markdown-gate";
import type { VaultEditorState } from "@repo/editor/vault-editor";
import { type OpenDoc, deriveOpenDoc, isMarkdownPath } from "@repo/editor/note/open-doc";

const NO_NOTE_STATE: VaultEditorState = {
  root: "",
  path: null,
  content: "",
  dirty: false,
  saving: false,
};

// keyed to the saved (path, content) it was computed for; analysis lags typing on purpose.
type Analyzed = {
  rawReason: GateReason | null;
  content: string;
  path: string | null;
};

export type OpenNoteState = {
  openPath: string | null;
  editor: VaultEditorState;
  analyzed: Analyzed;
  openDoc: OpenDoc;
  back: string[];
  forward: string[];
  /** installed by the owning session and cleared with it, so no separate teardown can forget to. */
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

const HISTORY_DEPTH = 50;

function capped(stack: readonly string[]): string[] {
  return stack.length > HISTORY_DEPTH ? stack.slice(stack.length - HISTORY_DEPTH) : [...stack];
}

// instance-scoped, not module state: an ended session's in-flight analysis must
// not publish into the next one's.
export type OpenNoteStore = {
  readonly store: StoreApi<OpenNoteState>;
  /** live read; never capture the result across awaits. */
  state: () => OpenNoteState;
  publishEditor: (editor: VaultEditorState) => void;
  publishOpenPath: (path: string | null, change?: OpenPathChange) => void;
  setFlush: (flush: (() => Promise<boolean>) | null) => void;
};

// `carry`: a rename moved the open note, so history entries naming the old path
// are rewritten rather than pushed, or Back would offer a path the rename deleted.
export type OpenPathChange = "navigate" | "carry";

export function createOpenNoteStore(): OpenNoteStore {
  const store = createStore<OpenNoteState>()(() => INITIAL_STATE);

  // openDoc stays referentially stable when its inputs didn't change, so a
  // consumer selecting it doesn't re-render on unrelated updates.
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

  let pendingAnalysis: { path: string | null; content: string } | null = null;

  // a path change is analyzed synchronously with the editor update so the gate
  // and the content never disagree; a same-path save is analyzed in a microtask
  // because analyzeMarkdown is a full Slate construct + parse + serialize (up to
  // 3 passes) and would block every autosave commit. a dirty buffer keeps the last verdict.
  function publishEditor(editor: VaultEditorState): void {
    const s = store.getState();
    const isMarkdownOpen = editor.path !== null && isMarkdownPath(editor.path);
    const pathChanged = s.analyzed.path !== editor.path;
    if ((pathChanged || s.analyzed.content !== editor.content) && !editor.dirty) {
      if (pathChanged) {
        pendingAnalysis = null;
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
          if (pendingAnalysis !== target) return;
          pendingAnalysis = null;
          // live state, not the snapshot captured at schedule time.
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
          // a mid-session rich→raw flip swaps Plate for the textarea under the
          // cursor; say why once. a fresh open lands in the textarea and doesn't toast.
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

// a back/forward move is recognized by value (`next` is already a stack top), not
// by a caller flag: the open is async and refusable, so a flag armed before a
// refused open would mis-attribute the next one.
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

export function backTarget(state: OpenNoteState): string | null {
  return state.back.at(-1) ?? null;
}

export function forwardTarget(state: OpenNoteState): string | null {
  return state.forward.at(-1) ?? null;
}
