// A Raindrop.io CSV export read into library items: the header by name in any order and case,
// a row per bookmark, folded by url key, every cell treated as hostile text. Pure: the job
// (import-service.ts) does the writing.
//
// Raindrop's columns: id, title, note, excerpt, url, folder, tags, created, cover, highlights,
// favorite. Only `url` is required; a per-collection export has no `folder`.

import { clipQuote } from "@repo/notes/annotations/store-schema";
import { UNSORTED_FOLDER } from "@repo/notes/items/item-kind";
import { itemNameFromTitle, itemStem } from "@repo/notes/items/item-name";
import { formatItemTime, parseItemTime } from "@repo/notes/items/item-time";
import { cleanUrl, isWebUrl, urlKey } from "@repo/notes/items/item-url";
import { isTagName } from "@repo/notes/knowledge/tag-grammar";

import type { ImportSkipReason } from "@repo/contract/local/imports/imports-schema";

import { parseCsv } from "./csv";

export interface RaindropHighlight {
  quote: string;
  note: string;
}

export interface RaindropRow {
  // the row's record number among the data rows, 1 the first under the header
  record: number;
  url: string;
  title: string;
  note: string;
  excerpt: string;
  folder: string[];
  tags: string[];
  created: string | null;
  cover: string | null;
  highlights: RaindropHighlight[];
  favorite: boolean;
}

export interface SkippedRow {
  record: number;
  reason: ImportSkipReason;
}

export type RaindropParse =
  | { ok: true; rows: RaindropRow[]; skipped: SkippedRow[] }
  | { ok: false; reason: "not-csv" | "no-url-column" | "empty" };

const COLUMNS = [
  "title",
  "note",
  "excerpt",
  "url",
  "folder",
  "tags",
  "created",
  "cover",
  "highlights",
  "favorite",
] as const;
type Column = (typeof COLUMNS)[number];

const TRASH = "trash";
const HIGHLIGHT_LINE = /^\s*highlight\s*:\s?/iu;
const NOTE_LINE = /^\s*note\s*:\s?/iu;

// `Highlight: …` opens a block and a `Note: …` line inside one starts its note; a cell with no
// `Highlight:` line is one quote
export const parseRaindropHighlights = (cell: string): RaindropHighlight[] => {
  const lines = cell.split(/\r\n|\r|\n/u);
  if (!lines.some((line) => HIGHLIGHT_LINE.test(line))) {
    const quote = cell.trim();
    return quote === "" ? [] : [{ note: "", quote }];
  }
  const blocks: { quote: string[]; note: string[] | null }[] = [];
  for (const line of lines) {
    const open = blocks.at(-1);
    if (HIGHLIGHT_LINE.test(line)) {
      blocks.push({ note: null, quote: [line.replace(HIGHLIGHT_LINE, "")] });
    } else if (open !== undefined && open.note === null && NOTE_LINE.test(line)) {
      open.note = [line.replace(NOTE_LINE, "")];
    } else if (open !== undefined) {
      (open.note ?? open.quote).push(line);
    }
  }
  return blocks
    .map((block) => ({
      note: (block.note ?? []).join("\n").trim(),
      quote: block.quote.join("\n").trim(),
    }))
    .filter((highlight) => highlight.quote !== "");
};

const folderSegments = (cell: string): string[] =>
  cell
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "");

const isTrue = (cell: string): boolean => ["true", "1", "yes"].includes(cell.trim().toLowerCase());

export const parseRaindropCsv = (text: string): RaindropParse => {
  const parsed = parseCsv(text);
  if (!parsed.ok) {
    return { ok: false, reason: "not-csv" };
  }
  const [header, ...data] = parsed.records;
  if (header === undefined) {
    return { ok: false, reason: "empty" };
  }
  const indexes = new Map<Column, number>();
  for (const [index, name] of header.entries()) {
    const column = COLUMNS.find((known) => known === name.trim().toLowerCase());
    if (column !== undefined && !indexes.has(column)) {
      indexes.set(column, index);
    }
  }
  if (!indexes.has("url")) {
    return { ok: false, reason: "no-url-column" };
  }
  if (data.length === 0) {
    return { ok: false, reason: "empty" };
  }
  const rows: RaindropRow[] = [];
  const skipped: SkippedRow[] = [];
  for (const [offset, record] of data.entries()) {
    const cell = (column: Column): string => {
      const index = indexes.get(column);
      return index === undefined ? "" : (record[index] ?? "");
    };
    const number = offset + 1;
    const url = cell("url").trim();
    const folder = folderSegments(cell("folder"));
    if (url === "") {
      skipped.push({ reason: "no-url", record: number });
    } else if (!isWebUrl(url)) {
      skipped.push({ reason: "not-web-url", record: number });
    } else if (folder[0]?.toLowerCase() === TRASH) {
      skipped.push({ reason: "in-trash", record: number });
    } else {
      const cover = cell("cover").trim();
      const created = cell("created").trim();
      rows.push({
        cover: cover === "" ? null : cover,
        created: created === "" ? null : created,
        excerpt: cell("excerpt"),
        favorite: isTrue(cell("favorite")),
        folder,
        highlights: parseRaindropHighlights(cell("highlights")),
        note: cell("note"),
        record: number,
        tags: cell("tags")
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag !== ""),
        title: cell("title"),
        url,
      });
    }
  }
  return { ok: true, rows, skipped };
};

// what one row becomes: an item of the library, keyed once
export interface PlannedItem {
  record: number;
  key: string;
  url: string;
  stem: string;
  folder: string;
  tags: string[];
  // formatItemTime, and the same instant in unix seconds for the highlights' dates
  saved: string;
  savedSeconds: number;
  description: string | null;
  // the item's body: the person's note on the bookmark
  note: string;
  pinned: boolean;
  // Raindrop's own picture, a hint the fill tries after the page's
  cover: string | null;
  highlights: { quote: string; text: string }[];
}

export interface ImportPlan {
  items: PlannedItem[];
  // rows folded into an earlier row with the same url key
  duplicates: number;
  // raw tags no tag name could be made of, each once
  droppedTags: string[];
}

const DESCRIPTION_MAX = 1000;
const MS_PER_SECOND = 1000;

// a tag as a library tag name: NFC, no `#`, every run of what a name cannot hold one `-`, each
// level trimmed of dashes; null when no name is left
export const toTagName = (raw: string): string | null => {
  const levels = raw
    .normalize("NFC")
    .replaceAll("#", "")
    .split("/")
    .map((level) =>
      level
        .replaceAll(/[^\p{L}\p{N}_-]+/gu, "-")
        .replaceAll(/-{2,}/gu, "-")
        .replaceAll(/^-+|-+$/gu, ""),
    )
    .filter((level) => level !== "");
  const name = levels.join("/");
  return isTagName(name) ? name : null;
};

// a library folder: each segment a name, `Unsorted` for none
const folderOf = (segments: readonly string[]): string => {
  const names = segments.flatMap((segment) => {
    const name = itemNameFromTitle(segment);
    return name === null ? [] : [name];
  });
  if (names.length === 0 || (names.length === 1 && names[0]?.toLowerCase() === "unsorted")) {
    return UNSORTED_FOLDER;
  }
  return names.join("/");
};

// ISO 8601 or unix seconds; anything else is the import's own moment
const savedMsOf = (created: string | null, now: number): number => {
  if (created === null) {
    return now;
  }
  if (/^\d+(?:\.\d+)?$/u.test(created)) {
    const seconds = Number(created);
    return Number.isFinite(seconds) ? Math.trunc(seconds * MS_PER_SECOND) : now;
  }
  return parseItemTime(created) ?? now;
};

const oneLine = (text: string): string | null => {
  const line = text.replaceAll(/\s+/gu, " ").trim().slice(0, DESCRIPTION_MAX).trim();
  return line === "" ? null : line;
};

const sameTag = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export const planRaindropImport = (rows: readonly RaindropRow[], now: number): ImportPlan => {
  const byKey = new Map<string, PlannedItem>();
  const dropped = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const key = urlKey(row.url);
    const url = cleanUrl(row.url);
    if (key === null || url === null) {
      continue;
    }
    const tags: string[] = [];
    for (const raw of row.tags) {
      const name = toTagName(raw);
      if (name === null) {
        dropped.add(raw);
      } else if (!tags.some((tag) => sameTag(tag, name))) {
        tags.push(name);
      }
    }
    const highlights = row.highlights.map((highlight) => ({
      quote: clipQuote(highlight.quote),
      text: highlight.note,
    }));
    const earlier = byKey.get(key);
    if (earlier !== undefined) {
      duplicates += 1;
      for (const tag of tags) {
        if (!earlier.tags.some((held) => sameTag(held, tag))) {
          earlier.tags.push(tag);
        }
      }
      for (const highlight of highlights) {
        if (!earlier.highlights.some((held) => held.quote === highlight.quote)) {
          earlier.highlights.push(highlight);
        }
      }
      continue;
    }
    const savedMs = savedMsOf(row.created, now);
    byKey.set(key, {
      cover: row.cover !== null && isWebUrl(row.cover) ? row.cover : null,
      description: oneLine(row.excerpt),
      folder: folderOf(row.folder),
      highlights,
      key,
      note: row.note.trim(),
      pinned: row.favorite,
      record: row.record,
      saved: formatItemTime(savedMs),
      savedSeconds: Math.floor(savedMs / MS_PER_SECOND),
      stem: itemStem(row.title.trim() === "" ? null : row.title, url),
      tags,
      url,
    });
  }
  return { droppedTags: [...dropped], duplicates, items: [...byKey.values()] };
};
