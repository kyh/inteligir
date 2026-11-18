import { useStore } from "zustand";

import { libraryTitles } from "@repo/editor/host-io";

export const useLibraryTitles = () => useStore(libraryTitles);

export const useTitleOf = (itemId: string) =>
  useStore(libraryTitles, (state) => state.byId.get(itemId) ?? null);
