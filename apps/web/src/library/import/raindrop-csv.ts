import { isWebUrl } from "@repo/contract/items/item-url";
import Papa from "papaparse";

import { bookmarkReader } from "./bookmark-reader";
import type { BookmarkHighlight, BookmarkParse, BookmarkRow } from "./bookmark-plan";

type RaindropParse = BookmarkParse<"not-csv" | "no-url-column">;

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

export const parseRaindropHighlights = (cell: string) => {
  const lines = cell.split(/\r\n|\r|\n/u);

  if (!lines.some((line) => HIGHLIGHT_LINE.test(line))) {
    const quote = cell.trim();

    return (quote === "" ? [] : [{ note: "", quote }]) satisfies BookmarkHighlight[];
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

  return blocks.flatMap((block) => {
    const quote = block.quote.join("\n").trim();

    return quote === "" ? [] : [{ note: (block.note ?? []).join("\n").trim(), quote }];
  });
};

const folderSegments = (cell: string) =>
  cell
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "");

const isTrue = (cell: string) => ["true", "1", "yes"].includes(cell.trim().toLowerCase());

const csvRecords = (text: string) => {
  const parsed = Papa.parse<string[]>(text, { delimiter: ",", skipEmptyLines: true });

  return parsed.errors.some((error) => error.code === "MissingQuotes") ? null : parsed.data;
};

export const parseRaindropCsv = (text: string) => {
  const records = csvRecords(text);

  if (records === null) {
    return { ok: false, reason: "not-csv" } satisfies RaindropParse;
  }

  const [header, ...data] = records;

  if (header === undefined) {
    return { ok: false, reason: "empty" } satisfies RaindropParse;
  }

  const indexes = new Map<Column, number>();

  for (const [index, name] of header.entries()) {
    const column = COLUMNS.find((known) => known === name.trim().toLowerCase());

    if (column !== undefined && !indexes.has(column)) {
      indexes.set(column, index);
    }
  }

  if (!indexes.has("url")) {
    return { ok: false, reason: "no-url-column" } satisfies RaindropParse;
  }

  if (data.length === 0) {
    return { ok: false, reason: "empty" } satisfies RaindropParse;
  }

  const rows: BookmarkRow[] = [];
  let skipped = 0;

  for (const record of data) {
    const cell = (column: Column) => {
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

  return { ok: true, rows, skipped } satisfies RaindropParse;
};

export const readRaindropCsv = bookmarkReader({
  parse: parseRaindropCsv,
  unreadable: {
    empty: "This file has no bookmarks in it.",
    "no-url-column":
      "This file isn't a Raindrop export: it has no column of web addresses. In Raindrop, open Settings › Backups, create a backup and choose its CSV file.",
    "not-csv":
      "This file isn't a Raindrop export. In Raindrop, open Settings › Backups, create a backup and choose its CSV file.",
  },
});
