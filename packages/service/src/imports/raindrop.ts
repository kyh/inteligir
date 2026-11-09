// A Raindrop.io CSV export read into library items: the header by name in any order and case,
// a row per bookmark, folded by url key, every cell treated as hostile text. A bookmark's highlights
// land in its note, each passage quoted with its own note under it. Pure: the library cell's import
// job does the writing (packages/service/src/library/cell-import-raindrop.ts).
//
// Raindrop's columns: id, title, note, excerpt, url, folder, tags, created, cover, highlights,
// favorite. Only `url` is required; a per-collection export has no `folder`.

import type { Paragraph, RootContent } from "mdast";
import { toMarkdown } from "mdast-util-to-markdown";
import { z } from "zod";

import { parseItemTime } from "@repo/editor/items/item-time";
import { cleanUrl, isWebUrl, urlKey } from "@repo/contract/items/item-url";
import { isTagName } from "@repo/contract/knowledge/tag-grammar";
import { ITEM_FIELD_CAPS } from "@repo/contract/library/library-item";
import { MD_PROCESSOR, MD_STRINGIFY } from "@repo/editor/markdown/md-plugins";
import { parseCsv } from "./csv";

/** @internal */
export interface RaindropHighlight {
  quote: string;
  note: string;
}

export interface RaindropRow {
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

// `skipped` counts the rows left out: one with no web address, or one in the bin
export type RaindropParse =
  | { ok: true; rows: RaindropRow[]; skipped: number }
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
/** @internal */
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
    } else if (open?.note === null && NOTE_LINE.test(line)) {
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
  let skipped = 0;
  for (const record of data) {
    const cell = (column: Column): string => {
      const index = indexes.get(column);
      return index === undefined ? "" : (record[index] ?? "");
    };
    const url = cell("url").trim();
    const folder = folderSegments(cell("folder"));
    if (!isWebUrl(url) || folder[0]?.toLowerCase() === TRASH) {
      skipped += 1;
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

// what one row becomes: an item of the library, keyed once, as the import job keeps it
export const plannedItemSchema = z.object({
  // Raindrop's own picture, a hint the fill tries after the page's
  cover: z.string().nullable(),
  description: z.string().nullable(),
  // its folder's path, null when Raindrop filed it in none
  folder: z.string().nullable(),
  key: z.string(),
  // the item's body as markdown: the person's note on the bookmark, then its highlights
  note: z.string(),
  pinned: z.boolean(),
  savedMs: z.number(),
  tags: z.array(z.string()),
  // the row's own title, null when it gave none
  title: z.string().nullable(),
  url: z.string(),
});
export type PlannedItem = z.infer<typeof plannedItemSchema>;

export interface ImportPlan {
  items: PlannedItem[];
  // rows folded into an earlier row with the same url key
  duplicates: number;
}

const DESCRIPTION_MAX = 1000;
const MS_PER_SECOND = 1000;
const DATE_MAX_MS = 8.64e15;

// a tag as a library tag name: NFC, no `#`, every run of what a name cannot hold one `-`, each
// level trimmed of dashes; null when no name is left
/** @internal */
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

// a bookmark's collection as a folder's path: Raindrop's own Unsorted is no folder
const folderOf = (segments: readonly string[]): string | null =>
  segments.length === 0 || (segments.length === 1 && segments[0]?.toLowerCase() === "unsorted")
    ? null
    : segments.join("/");

const readCreated = (created: string): number | null =>
  /^\d+(?:\.\d+)?$/u.test(created)
    ? Math.trunc(Number(created) * MS_PER_SECOND)
    : parseItemTime(created);

// ISO 8601 or unix seconds; anything else, or an instant no field or `Date` holds, is the import's
// own moment
const savedMsOf = (created: string | null, now: number): number => {
  const read = created === null ? null : readCreated(created);
  return read !== null && Number.isInteger(read) && read >= 0 && read <= DATE_MAX_MS ? read : now;
};

const oneLine = (text: string): string | null => {
  const line = text.replaceAll(/\s+/gu, " ").trim().slice(0, DESCRIPTION_MAX).trim();
  return line === "" ? null : line;
};

const sameTag = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const paragraphOf = (value: string): Paragraph => ({
  children: [{ type: "text", value }],
  type: "paragraph",
});

// Raindrop's words are text, so the dialect's own writer spells them, escaping what would read as
// markdown
const HIGHLIGHT_MARKDOWN = {
  ...MD_STRINGIFY,
  extensions: MD_PROCESSOR.data("toMarkdownExtensions"),
};

// the note as the person wrote it, then each highlight as a quote with its own note under it
const noteWithHighlights = (note: string, highlights: readonly RaindropHighlight[]): string => {
  if (highlights.length === 0) {
    return note;
  }
  const flow = highlights.flatMap((highlight): RootContent[] => [
    { children: [paragraphOf(highlight.quote)], type: "blockquote" },
    ...(highlight.note === "" ? [] : [paragraphOf(highlight.note)]),
  ]);
  const quoted = toMarkdown({ children: flow, type: "root" }, HIGHLIGHT_MARKDOWN).trimEnd();
  return note === "" ? quoted : `${note}\n\n${quoted}`;
};

interface Planning {
  readonly item: PlannedItem;
  readonly highlights: RaindropHighlight[];
}

export const planRaindropImport = (rows: readonly RaindropRow[], now: number): ImportPlan => {
  const byKey = new Map<string, Planning>();
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
      if (name !== null && !tags.some((tag) => sameTag(tag, name))) {
        tags.push(name);
      }
    }
    const earlier = byKey.get(key);
    if (earlier !== undefined) {
      duplicates += 1;
      for (const tag of tags) {
        if (!earlier.item.tags.some((held) => sameTag(held, tag))) {
          earlier.item.tags.push(tag);
        }
      }
      for (const highlight of row.highlights) {
        if (!earlier.highlights.some((held) => held.quote === highlight.quote)) {
          earlier.highlights.push(highlight);
        }
      }
      continue;
    }
    const item: PlannedItem = {
      cover:
        row.cover !== null && row.cover.length <= ITEM_FIELD_CAPS.url && isWebUrl(row.cover)
          ? row.cover
          : null,
      description: oneLine(row.excerpt),
      folder: folderOf(row.folder),
      key,
      note: row.note.trim(),
      pinned: row.favorite,
      savedMs: savedMsOf(row.created, now),
      tags,
      title: row.title.trim() === "" ? null : row.title.trim(),
      url,
    };
    byKey.set(key, { highlights: [...row.highlights], item });
  }
  return {
    duplicates,
    items: [...byKey.values()].map(({ highlights, item }) => ({
      ...item,
      note: noteWithHighlights(item.note, highlights),
    })),
  };
};
