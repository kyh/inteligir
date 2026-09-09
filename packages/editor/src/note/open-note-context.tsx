import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";

import { openDocPath } from "@repo/editor/note/open-doc";
import type { OpenNoteState, OpenNoteStore } from "@repo/editor/note/open-note-store";

const OpenNoteStoreContext = createContext<OpenNoteStore | null>(null);

export const OpenNoteStoreProvider = ({
  store,
  children,
}: {
  store: OpenNoteStore;
  children: ReactNode;
}) => <OpenNoteStoreContext.Provider value={store}>{children}</OpenNoteStoreContext.Provider>;

// a missing provider is a mount-order bug; throw rather than make every call site carry a dead null check.
export const useOpenNoteStore = (): OpenNoteStore => {
  const store = useContext(OpenNoteStoreContext);
  if (store === null) {
    throw new Error("useOpenNoteStore used outside <OpenNoteStoreProvider>");
  }
  return store;
};

export const useOpenNote = <T,>(selector: (state: OpenNoteState) => T): T =>
  useStore(useOpenNoteStore().store, selector);

export const useOpenNotePath = (): string | null => useOpenNote((s) => openDocPath(s.openDoc));
