// What every device calls an item's kind and a library scope, and the kind chips in the order a
// person scans them, spelled once.

import type { ItemKind } from "@repo/contract/items/item-kind";
import type { LibraryScope } from "@repo/contract/library-scope";

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

// what a header calls the scope, every item by the name the device gives its home (`all`)
export const scopeTitle = (
  scope: LibraryScope,
  folders: readonly { readonly id: string; readonly name: string }[],
  all: string,
): string => {
  switch (scope.kind) {
    case "all": {
      return all;
    }
    case "unsorted": {
      return "Unsorted";
    }
    case "folder": {
      return folders.find((folder) => folder.id === scope.folderId)?.name ?? "Folder";
    }
    case "tag": {
      return `#${scope.tag}`;
    }
    case "deleted": {
      return "Deleted";
    }
    // no default
  }
};

// the folder a save from this scope lands in: the shown folder's, else none (Unsorted)
export const saveFolderOf = (scope: LibraryScope): string | null =>
  scope.kind === "folder" ? scope.folderId : null;
