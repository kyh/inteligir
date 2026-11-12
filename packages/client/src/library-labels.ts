// What every device calls an item's kind, the kind chips in the order a person scans them, and what
// a library scope asks the cell's listing, spelled once.

import type { ItemKind } from "@repo/contract/items/item-kind";
import type { LibraryScope } from "@repo/contract/library-scope";
import type { listingQuerySchema } from "@repo/contract/library/library-wire";
import type { z } from "zod";

type ListingQuery = z.infer<typeof listingQuerySchema>;

export const KIND_LABELS = {
  audio: "Audio",
  file: "File",
  image: "Image",
  link: "Link",
  note: "Note",
  pdf: "PDF",
  video: "Video",
} satisfies Record<ItemKind, string>;

export const KIND_CHIP_LABELS = {
  audio: "Audio",
  file: "Files",
  image: "Images",
  link: "Links",
  note: "Notes",
  pdf: "PDFs",
  video: "Videos",
} satisfies Record<ItemKind, string>;

export const CHIP_ORDER: readonly ItemKind[] = [
  "link",
  "video",
  "audio",
  "image",
  "pdf",
  "file",
  "note",
];

// every item, those in no folder, a folder and what is under it, a tag and its children, or what
// was deleted
export const scopeQuery = (
  scope: LibraryScope,
): Pick<ListingQuery, "deleted" | "folderId" | "subfolders" | "tag"> => {
  switch (scope.kind) {
    case "all": {
      return { deleted: false };
    }
    case "unsorted": {
      return { deleted: false, folderId: null };
    }
    case "folder": {
      return { deleted: false, folderId: scope.folderId, subfolders: true };
    }
    case "tag": {
      return { deleted: false, tag: scope.tag };
    }
    case "deleted": {
      return { deleted: true };
    }
    // no default
  }
};

// the folder a save from this scope lands in: the shown folder's, else none (Unsorted)
export const saveFolderOf = (scope: LibraryScope): string | null =>
  scope.kind === "folder" ? scope.folderId : null;
