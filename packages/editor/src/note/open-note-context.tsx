// React's door to ONE pane's open-note store (#595 made the store an
// instance): the pane mounts a provider around its editor subtree, and every
// consumer below reads its own pane's note with the same `useOpenNote(sel)`
// call shape the singleton era had — the split is invisible at call sites.

import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";

import { openDocPath } from "@repo/editor/note/open-doc";
import type { OpenNoteState, OpenNoteStore } from "@repo/editor/note/open-note-store";

const OpenNoteStoreContext = createContext<OpenNoteStore | null>(null);

export function OpenNoteStoreProvider({
  store,
  children,
}: {
  store: OpenNoteStore;
  children: ReactNode;
}) {
  return <OpenNoteStoreContext.Provider value={store}>{children}</OpenNoteStoreContext.Provider>;
}

/** A missing provider is a mount-order bug, never a state the UI renders
 * around — throw rather than make every call site carry a dead null check. */
export function useOpenNoteStore(): OpenNoteStore {
  const store = useContext(OpenNoteStoreContext);
  if (store === null) throw new Error("useOpenNoteStore used outside <OpenNoteStoreProvider>");
  return store;
}

/** Subscribe to a slice of this pane's open-note state:
 * `useOpenNote((s) => s.mode)`. A consumer re-renders only when ITS selected
 * value changes — the seam that keeps a keystroke from re-rendering the app. */
export function useOpenNote<T>(selector: (state: OpenNoteState) => T): T {
  return useStore(useOpenNoteStore().store, selector);
}

/** The note THIS pane holds — the identity everything under a pane keys off
 * (its sidecar, its fold set, its live editor). Null when the pane holds no
 * document; a note still loading already names its path. */
export function usePaneNotePath(): string | null {
  return useOpenNote((s) => openDocPath(s.openDoc));
}
