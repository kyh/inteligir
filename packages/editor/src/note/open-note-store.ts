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
}

const INITIAL_STATE: OpenNoteState = {
  editor: EMPTY_EDITOR_STATE,
  openDoc: { kind: "none" },
  openPath: null,
};

// instance-scoped, not module state: each session's store is its own, so an ended session's
// late publish cannot land in the next one's.
export interface OpenNoteStore {
  readonly store: StoreApi<OpenNoteState>;
  /** live read; never capture the result across awaits. */
  state: () => OpenNoteState;
  publishEditor: (editor: VaultEditorState) => void;
  publishOpenPath: (path: string | null) => void;
}

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

  const publishOpenPath = (path: string | null): void => {
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
