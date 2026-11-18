import { cleanUrl, isWebUrl, urlKey } from "@repo/contract/items/item-url";
import { isTagName } from "@repo/contract/knowledge/tag-grammar";
import { importedFields, stubFields } from "@repo/contract/library/item-makes";
import { ITEM_FIELD_CAPS } from "@repo/contract/library/library-item";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { parseItemTime } from "@repo/editor/headless/items/item-time";
import Papa from "papaparse";

interface RaindropHighlight {
  readonly note: string;
  readonly quote: string;
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

type RaindropParse =
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

export const parseRaindropHighlights = (cell: string) => {
  const lines = cell.split(/\r\n|\r|\n/u);

  if (!lines.some((line) => HIGHLIGHT_LINE.test(line))) {
    const quote = cell.trim();

    return (quote === "" ? [] : [{ note: "", quote }]) satisfies RaindropHighlight[];
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

  const rows: RaindropRow[] = [];
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

export interface PlannedItem {
  readonly cover: string | null;
  readonly description: string | null;
  readonly folder: string | null;
  readonly highlights: RaindropHighlight[];
  readonly note: string;
  readonly pinned: boolean;
  readonly savedMs: number;
  readonly tags: string[];
  readonly title: string | null;
  readonly url: string;
}

interface ImportPlan {
  items: PlannedItem[];
  duplicates: number;
}

const DESCRIPTION_MAX = 1000;
const MS_PER_SECOND = 1000;
const DATE_MAX_MS = 8.64e15;

export const toTagName = (raw: string) => {
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

const folderOf = (segments: readonly string[]) =>
  segments.length === 0 || (segments.length === 1 && segments[0]?.toLowerCase() === "unsorted")
    ? null
    : segments.join("/");

const readCreated = (created: string) =>
  /^\d+(?:\.\d+)?$/u.test(created)
    ? Math.trunc(Number(created) * MS_PER_SECOND)
    : parseItemTime(created);

const savedMsOf = (created: string | null, now: number) => {
  const read = created === null ? null : readCreated(created);

  return read !== null && Number.isInteger(read) && read >= 0 && read <= DATE_MAX_MS ? read : now;
};

const oneLine = (text: string) => {
  const line = text.replaceAll(/\s+/gu, " ").trim().slice(0, DESCRIPTION_MAX).trim();

  return line === "" ? null : line;
};

const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const paragraphs = (text: string) =>
  text
    .split(/\n[\t ]*\n/u)
    .map((part) => part.trim())
    .filter((part) => part !== "");

const paragraph = (text: string) => ({ children: [{ text }], type: "p" as const });

export const highlightBlocks = (
  highlights: readonly RaindropHighlight[],
  newBlockId: () => string,
) =>
  highlights.flatMap((highlight) => {
    const quoted = paragraphs(highlight.quote).map(paragraph);

    return [
      ...(quoted.length === 0
        ? []
        : [{ children: quoted, id: newBlockId(), type: "blockquote" as const }]),
      ...paragraphs(highlight.note).map((text) => ({ ...paragraph(text), id: newBlockId() })),
    ] satisfies LibraryBlock[];
  });

export const planRaindropImport = (rows: readonly RaindropRow[], now: number) => {
  const byKey = new Map<string, PlannedItem>();
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
        if (!earlier.tags.some((held) => sameTag(held, tag))) {
          earlier.tags.push(tag);
        }
      }

      for (const highlight of row.highlights) {
        if (!earlier.highlights.some((held) => held.quote === highlight.quote)) {
          earlier.highlights.push(highlight);
        }
      }

      continue;
    }

    byKey.set(key, {
      cover:
        row.cover !== null && row.cover.length <= ITEM_FIELD_CAPS.url && isWebUrl(row.cover)
          ? row.cover
          : null,
      description: oneLine(row.excerpt),
      folder: folderOf(row.folder),
      highlights: [...row.highlights],
      note: row.note.trim(),
      pinned: row.favorite,
      savedMs: savedMsOf(row.created, now),
      tags,
      title: row.title.trim() === "" ? null : row.title.trim(),
      url,
    });
  }

  return { duplicates, items: [...byKey.values()] } satisfies ImportPlan;
};

export const bookmarkFields = (item: PlannedItem) =>
  importedFields({
    ...stubFields({
      folderId: null,
      savedAt: item.savedMs,
      tags: item.tags,
      title: item.title?.slice(0, ITEM_FIELD_CAPS.line),
      url: item.url,
    }),
    description: item.description,
    pinnedAt: item.pinned ? item.savedMs : null,
  });
