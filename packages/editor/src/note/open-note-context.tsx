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

// a missing provider is a mount-order bug; throw rather than make every call site carry a dead null check.
export function useOpenNoteStore(): OpenNoteStore {
  const store = useContext(OpenNoteStoreContext);
  if (store === null) throw new Error("useOpenNoteStore used outside <OpenNoteStoreProvider>");
  return store;
}

export function useOpenNote<T>(selector: (state: OpenNoteState) => T): T {
  return useStore(useOpenNoteStore().store, selector);
}

export function useOpenNotePath(): string | null {
  return useOpenNote((s) => openDocPath(s.openDoc));
}
