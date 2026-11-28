import { cleanUrl, isWebUrl, urlKey } from "@repo/contract/items/item-url";
import { isTagName } from "@repo/contract/knowledge/tag-grammar";
import { importedFields, stubFields } from "@repo/contract/library/item-makes";
import { ITEM_FIELD_CAPS } from "@repo/contract/items/item-field-caps";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { parseItemTime } from "@repo/editor/headless/items/item-time";

export interface BookmarkHighlight {
  readonly note: string;
  readonly quote: string;
}

export interface BookmarkRow {
  url: string;
  title: string;
  note: string;
  excerpt: string;
  folder: string[];
  tags: string[];
  created: string | null;
  cover: string | null;
  highlights: BookmarkHighlight[];
  favorite: boolean;
}

export type BookmarkParse<Reason extends string> =
  | { ok: true; rows: BookmarkRow[]; skipped: number }
  | { ok: false; reason: Reason | "empty" };

export interface PlannedBookmark {
  readonly cover: string | null;
  readonly description: string | null;
  readonly folder: string | null;
  readonly highlights: BookmarkHighlight[];
  readonly note: string;
  readonly pinned: boolean;
  readonly savedMs: number;
  readonly tags: string[];
  readonly title: string | null;
  readonly url: string;
}

interface ImportPlan {
  items: PlannedBookmark[];
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
  highlights: readonly BookmarkHighlight[],
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

export const planBookmarks = (rows: readonly BookmarkRow[], now: number) => {
  const byKey = new Map<string, PlannedBookmark>();
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

export const bookmarkFields = (item: PlannedBookmark) =>
  importedFields({
    ...stubFields({
      parentId: null,
      savedAt: item.savedMs,
      tags: item.tags,
      title: item.title?.slice(0, ITEM_FIELD_CAPS.line),
      url: item.url,
    }),
    description: item.description,
    pinnedAt: item.pinned ? item.savedMs : null,
  });
