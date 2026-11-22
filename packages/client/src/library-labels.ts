import type { ItemKind } from "@repo/contract/items/item-kind";
import type { LibraryScope } from "@repo/contract/library-scope";

export const KIND_LABELS = {
  audio: "Audio",
  file: "File",
  folder: "Folder",
  image: "Image",
  link: "Link",
  list: "List",
  note: "Note",
  pdf: "PDF",
  video: "Video",
} satisfies Record<ItemKind, string>;

export const KIND_CHIP_LABELS = {
  audio: "Audio",
  file: "Files",
  folder: "Folders",
  image: "Images",
  link: "Links",
  list: "Lists",
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
  containers: readonly { readonly id: string; readonly title: string }[],
  all: string,
) => {
  switch (scope.kind) {
    case "all": {
      return all;
    }

    case "unsorted": {
      return "Unsorted";
    }

    case "parent": {
      return containers.find((held) => held.id === scope.parentId)?.title ?? "Folder";
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
  scope.kind === "parent" ? scope.parentId : null;
