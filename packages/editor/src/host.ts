import { useStore } from "zustand";

import { libraryTitles } from "@repo/editor/host-io";
import type { LibraryTitles } from "@repo/editor/host-io";

// React's door to the host singleton; anything outside a component reads getEditorHostIo() itself.

export const useLibraryTitles = (): LibraryTitles => useStore(libraryTitles);

// the name an item goes by now, so a page link that names it by id shows it as it is; null for an
// item the library's titles do not list
export const useTitleOf = (itemId: string): string | null =>
  useStore(libraryTitles, (state) => state.byId.get(itemId) ?? null);
