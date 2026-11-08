// What a card and Info say about an item, spelled once: the kind's word, a size, the meta line.

import type { ReplicaListingRow } from "@repo/library-replica/library-replica";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { URL_ITEM_KINDS } from "@repo/notes/items/item-kind";
import { urlHost } from "@repo/notes/items/item-url";
import { relativeTimeLabel } from "../relative-time";

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
export const coverOf = (row: ReplicaListingRow): string | null =>
  row.fields.coverSha ?? (row.kind === "image" ? row.fields.originalSha : null);

export const isUrlItem = (row: Pick<ReplicaListingRow, "kind" | "url">): boolean =>
  row.url !== null && URL_ITEM_KINDS.some((kind) => kind === row.kind);

export const fileExtensionLabel = (name: string | null): string => {
  if (name === null) {
    return "";
  }
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
};

// where a saved page came from: its site's own name, else its address's host
const whereFrom = (row: ReplicaListingRow): string | null =>
  row.fields.site ?? (row.url === null ? null : urlHost(row.url));

// the card's one line under the title: where it came from or what it is, when, and its tags
export const cardMeta = (row: ReplicaListingRow, nowMs: number): string => {
  const parts: string[] = [];
  switch (row.kind) {
    case "link":
    case "video":
    case "audio": {
      parts.push(whereFrom(row) ?? KIND_LABELS[row.kind]);
      break;
    }
    case "image":
    case "pdf":
    case "note": {
      parts.push(KIND_LABELS[row.kind]);
      break;
    }
    case "file": {
      parts.push(fileExtensionLabel(row.fields.originalName) || KIND_LABELS.file);
      break;
    }
    default: {
      const exhaustive: never = row.kind;
      return exhaustive;
    }
  }
  parts.push(relativeTimeLabel(row.savedAt, nowMs, { inSentence: true }).replace(/ ago$/u, ""));
  const tags = row.tags.slice(0, 3).map((tag) => `#${tag}`);
  if (tags.length > 0) {
    parts.push(tags.join(" "));
  }
  return parts.join(" · ");
};
