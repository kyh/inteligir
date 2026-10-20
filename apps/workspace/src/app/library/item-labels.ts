// What a card and Info say about an item, spelled once: the kind's word, a size, the meta line.

import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { URL_ITEM_KINDS } from "@repo/notes/items/item-kind";
import { parseItemTime } from "@repo/notes/items/item-time";
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

const KB = 1024;
const MB = KB * 1024;

// "2.4 MB", "640 KB", "12 bytes"
export const formatBytes = (bytes: number): string => {
  if (bytes >= MB) {
    return `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`;
  }
  if (bytes >= KB) {
    return `${String(Math.round(bytes / KB))} KB`;
  }
  return bytes === 1 ? "1 byte" : `${String(bytes)} bytes`;
};

export const isUrlItem = (row: Pick<ItemRowWire, "kind" | "url">): boolean =>
  row.url !== null && URL_ITEM_KINDS.some((kind) => kind === row.kind);

// when the item came in, else when it last changed: what the grid sorts by when nothing is said
const itemTimeMs = (row: Pick<ItemRowWire, "saved" | "modifiedMs">): number | null =>
  (row.saved === null ? null : parseItemTime(row.saved)) ?? row.modifiedMs;

export const fileExtensionLabel = (path: string | null): string => {
  if (path === null) {
    return "";
  }
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
};

// the card's one line under the title: where it came from or what it is, when, and its tags
export const cardMeta = (row: ItemRowWire, nowMs: number): string => {
  const parts: string[] = [];
  switch (row.kind) {
    case "link":
    case "video":
    case "audio": {
      const where = row.site ?? row.host;
      parts.push(where ?? KIND_LABELS[row.kind]);
      break;
    }
    case "image":
    case "pdf": {
      parts.push(KIND_LABELS[row.kind]);
      if (row.fileBytes !== null) {
        parts.push(formatBytes(row.fileBytes));
      }
      break;
    }
    case "file": {
      parts.push(fileExtensionLabel(row.file) || KIND_LABELS.file);
      if (row.fileBytes !== null) {
        parts.push(formatBytes(row.fileBytes));
      }
      break;
    }
    case "note": {
      parts.push(KIND_LABELS.note);
      break;
    }
    default: {
      const exhaustive: never = row.kind;
      return exhaustive;
    }
  }
  const at = itemTimeMs(row);
  if (at !== null) {
    parts.push(relativeTimeLabel(at, nowMs, { inSentence: true }).replace(/ ago$/u, ""));
  }
  const tags = row.tags.slice(0, 3).map((tag) => `#${tag}`);
  if (tags.length > 0) {
    parts.push(tags.join(" "));
  }
  return parts.join(" · ");
};
