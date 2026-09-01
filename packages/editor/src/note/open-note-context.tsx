// React's door to the open-note store. The store is an INSTANCE, not module
// state, so the workspace mounts a provider around the editor subtree and
// every consumer below reads through `useOpenNote(selector)` — which means a
// test can drive a fresh machine.

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

/** Subscribe to a slice of the open-note state: `useOpenNote((s) => s.mode)`.
 * A consumer re-renders only when ITS selected value changes — the seam that
 * keeps a keystroke from re-rendering the app. */
export function useOpenNote<T>(selector: (state: OpenNoteState) => T): T {
  return useStore(useOpenNoteStore().store, selector);
}

/** The note the editor currently holds — the identity everything under it
 * keys off (the sidecar, the fold set, the live editor). Null when no
 * document is held; a note still loading already names its path. */
export function useOpenNotePath(): string | null {
  return useOpenNote((s) => openDocPath(s.openDoc));
}
