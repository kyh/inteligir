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

export const scopeTitle = (
  scope: LibraryScope,
  folders: readonly { readonly id: string; readonly name: string }[],
  all: string,
) => {
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

    default: {
      throw new Error(`unexpected ${String(scope satisfies never)}`);
    }
  }
};

export const saveFolderOf = (scope: LibraryScope) =>
  scope.kind === "folder" ? scope.folderId : null;
