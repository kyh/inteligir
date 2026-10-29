// a zustand store rather than VaultContext state: the editor snapshot changes per
// keystroke and context would re-render every consumer. publishing is synchronous
// with the controller's emission so a controlled textarea updates in the same
// flush as the keystroke; an effect-time mirror lets React restore the input first.

import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import { EMPTY_EDITOR_STATE } from "@repo/editor/vault-editor";
import type { VaultEditorState } from "@repo/editor/vault-editor";
import { deriveOpenDoc } from "@repo/editor/note/open-doc";
import type { OpenDoc } from "@repo/editor/note/open-doc";

export interface OpenNoteState {
  openPath: string | null;
  editor: VaultEditorState;
  openDoc: OpenDoc;
  // `null` is the library: nothing open is a step in the one history like any item
  back: HistoryEntry[];
  forward: HistoryEntry[];
}

export type HistoryEntry = string | null;

const INITIAL_STATE: OpenNoteState = {
  back: [],
  editor: EMPTY_EDITOR_STATE,
  forward: [],
  openDoc: { kind: "none" },
  openPath: null,
};

const HISTORY_DEPTH = 50;

const capped = (stack: readonly HistoryEntry[]): HistoryEntry[] =>
  stack.length > HISTORY_DEPTH ? stack.slice(stack.length - HISTORY_DEPTH) : [...stack];

// a back/forward move is recognized by value (`next` is already a stack top), not
// by a caller flag: the open is async and refusable, so a flag armed before a
// refused open would mis-attribute the next one. The library is an entry like any
// item, so leaving it is remembered and Back returns to it.
const movedHistory = (
  state: OpenNoteState,
  prev: HistoryEntry,
  next: HistoryEntry,
): Pick<OpenNoteState, "back" | "forward"> => {
  if (state.back.length > 0 && state.back.at(-1) === next) {
    return { back: state.back.slice(0, -1), forward: capped([...state.forward, prev]) };
  }
  if (state.forward.length > 0 && state.forward.at(-1) === next) {
    return { back: capped([...state.back, prev]), forward: state.forward.slice(0, -1) };
  }
  return { back: capped([...state.back, prev]), forward: [] };
};

// instance-scoped, not module state: each session's store is its own, so an ended session's
// late publish cannot land in the next one's.
export interface OpenNoteStore {
  readonly store: StoreApi<OpenNoteState>;
  /** live read; never capture the result across awaits. */
  state: () => OpenNoteState;
  publishEditor: (editor: VaultEditorState) => void;
  publishOpenPath: (path: string | null, change?: OpenPathChange) => void;
}

// `carry`: a rename moved the open note, so history entries naming the old path
// are rewritten rather than pushed, or Back would offer a path the rename deleted.
export type OpenPathChange = "navigate" | "carry";

export const createOpenNoteStore = (): OpenNoteStore => {
  const store = createStore<OpenNoteState>()(() => INITIAL_STATE);

  // openDoc stays referentially stable when its inputs didn't change, so a
  // consumer selecting it doesn't re-render on unrelated updates.
  const apply = (partial: Partial<Pick<OpenNoteState, "openPath" | "editor">>): void => {
    store.setState((s) => {
      const merged = { ...s, ...partial };
      const loadedPath = merged.editor.kind === "open" ? merged.editor.path : null;
      const sameDocInputs =
        merged.openPath === s.openPath &&
        loadedPath === (s.editor.kind === "open" ? s.editor.path : null);
      merged.openDoc = sameDocInputs
        ? s.openDoc
        : deriveOpenDoc({ loadedPath, openPath: merged.openPath });
      return merged;
    });
  };

  const publishEditor = (editor: VaultEditorState): void => {
    apply({ editor });
  };

  const publishOpenPath = (path: string | null, change: OpenPathChange = "navigate"): void => {
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
    if (path === null) {
      publishEditor(EMPTY_EDITOR_STATE);
    }
  };

  return {
    publishEditor,
    publishOpenPath,
    state: () => store.getState(),
    store,
  };
};

// where Back or Forward lands: an item's path, or `null` for the library; null when that stack is empty.
export const historyStep = (
  state: OpenNoteState,
  direction: "back" | "forward",
): { readonly to: HistoryEntry } | null => {
  const stack = direction === "back" ? state.back : state.forward;
  return stack.length === 0 ? null : { to: stack.at(-1) ?? null };
};
