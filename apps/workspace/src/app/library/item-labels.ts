// What a card and Info say about an item, spelled once: the kind's word, a size, the meta line.

import type { ItemKind } from "@repo/contract/items/item-kind";
import { URL_ITEM_KINDS } from "@repo/contract/items/item-kind";
import { urlHost } from "@repo/contract/items/item-url";
import { relativeTimeLabel } from "../relative-time";
import type { ListedItem } from "./listing";

export const KIND_LABELS = {
  audio: "Audio",
  file: "File",
  image: "Image",
  link: "Link",
  note: "Note",
  pdf: "PDF",
  video: "Video",
} satisfies Record<ItemKind, string>;

// the chips' words, plural, in the order the chips draw
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

const COUNT_FORMAT = new Intl.NumberFormat("en-US");

// "8,512": every count a person reads
export const formatCount = (count: number): string => COUNT_FORMAT.format(count);

// the file that stands for an item on its card and in Quick Look: its cover, else a picture's own
export const coverOf = (row: ListedItem): string | null =>
  row.fields.coverSha ?? (row.fields.kind === "image" ? row.fields.originalSha : null);

export const isUrlItem = (fields: Pick<ListedItem["fields"], "kind" | "url">): boolean =>
  fields.url !== null && URL_ITEM_KINDS.some((kind) => kind === fields.kind);

export const fileExtensionLabel = (name: string | null): string => {
  if (name === null) {
    return "";
  }
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
};

// where a saved page came from: its site's own name, else its address's host
const whereFrom = (row: ListedItem): string | null =>
  row.fields.site ?? (row.fields.url === null ? null : urlHost(row.fields.url));

// the card's one line under the title: where it came from or what it is, when, and its tags
export const cardMeta = (row: ListedItem, nowMs: number): string => {
  const parts: string[] = [];
  switch (row.fields.kind) {
    case "link":
    case "video":
    case "audio": {
      parts.push(whereFrom(row) ?? KIND_LABELS[row.fields.kind]);
      break;
    }
    case "image":
    case "pdf":
    case "note": {
      parts.push(KIND_LABELS[row.fields.kind]);
      break;
    }
    case "file": {
      parts.push(fileExtensionLabel(row.fields.originalName) || KIND_LABELS.file);
      break;
    }
    default: {
      const exhaustive: never = row.fields.kind;
      return exhaustive;
    }
  }
  parts.push(
    relativeTimeLabel(row.fields.savedAt, nowMs, { inSentence: true }).replace(/ ago$/u, ""),
  );
  const tags = row.tags.slice(0, 3).map((tag) => `#${tag}`);
  if (tags.length > 0) {
    parts.push(tags.join(" "));
  }
  return parts.join(" · ");
};
