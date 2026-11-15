// The ranked index, `search_fts`: FTS5, which sqlite-core cannot declare, so its statements are raw
// text over the cell's port (`../library/cell-storage`). The cell keeps an item's row in code,
// beside the item's own, never by a trigger, and a search asks it by the one policy
// (`./search-query`).

import { z } from "zod";

import { utf8ByteLength } from "@repo/contract/library/canonical-json";
import type { ItemSearchText } from "@repo/contract/library/derive-item";

import type { CellStorage } from "../library/cell-storage";
import { parseRow } from "../library/library-sql";
import { renderFtsMatch } from "./fts-match";
import { planSearchQuery, SEARCH_FIELD_WEIGHTS, stemText } from "./search-query";
import type { SearchQueryTerm } from "./search-query";

// a Durable Object row holds 2 MB, and an index row holds every column with its stem shadow
export const SEARCH_ROW_MAX_BYTES = 1_900_000;
const TITLE_MAX_BYTES = 4096;
const HEADINGS_MAX_BYTES = 256 * 1024;
const META_MAX_BYTES = 64 * 1024;

// the longest prefix of `text` within `maxBytes` of UTF-8, never splitting a character
const clipToBytes = (text: string, maxBytes: number): string => {
  if (utf8ByteLength(text) <= maxBytes) {
    return text;
  }
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    const size = utf8ByteLength(char);
    if (bytes + size > maxBytes) {
      break;
    }
    bytes += size;
    end += char.length;
  }
  return text.slice(0, end);
};

export interface SearchRow {
  readonly title: string;
  readonly headings: string;
  readonly meta: string;
  readonly body: string;
  readonly titleStems: string;
  readonly headingStems: string;
  readonly metaStems: string;
  readonly bodyStems: string;
}

export const searchRowBytes = (row: SearchRow): number =>
  [
    row.title,
    row.headings,
    row.meta,
    row.body,
    row.titleStems,
    row.headingStems,
    row.metaStems,
    row.bodyStems,
  ].reduce((sum, column) => sum + utf8ByteLength(column), 0);

// an item's index row within SEARCH_ROW_MAX_BYTES: the short columns are capped, and the body
// gets what is left, so a long item ranks by the part of it the row can hold
export const searchRowOf = (text: ItemSearchText): SearchRow => {
  const title = clipToBytes(text.title, TITLE_MAX_BYTES);
  const headings = clipToBytes(text.headings, HEADINGS_MAX_BYTES);
  const metaText = clipToBytes(text.meta, META_MAX_BYTES);
  const fixed = {
    headingStems: stemText(headings),
    headings,
    meta: metaText,
    metaStems: stemText(metaText),
    title,
    titleStems: stemText(title),
  };
  const room = SEARCH_ROW_MAX_BYTES - searchRowBytes({ ...fixed, body: "", bodyStems: "" });
  let budget = Math.floor(room / 2);
  for (;;) {
    const body = clipToBytes(text.body, budget);
    const row = { ...fixed, body, bodyStems: stemText(body) };
    if (searchRowBytes(row) <= SEARCH_ROW_MAX_BYTES || budget === 0) {
      return row;
    }
    budget = Math.floor(budget * 0.9);
  }
};

// an item's row gone from the index, as a purge or a rewrite leaves it
export const dropSearchRow = (storage: CellStorage, itemId: string): void => {
  storage.run("DELETE FROM search_fts WHERE rowid = (SELECT rid FROM items WHERE id = ?)", [
    itemId,
  ]);
};

const INSERT_SEARCH_ROW = `INSERT INTO search_fts (rowid, title, headings, meta, body, title_stems,
  heading_stems, meta_stems, body_stems)
SELECT rid, ?, ?, ?, ?, ?, ?, ?, ? FROM items WHERE id = ?`;

export const storeSearchRow = (
  storage: CellStorage,
  itemId: string,
  text: ItemSearchText,
): void => {
  const row = searchRowOf(text);
  dropSearchRow(storage, itemId);
  storage.run(INSERT_SEARCH_ROW, [
    row.title,
    row.headings,
    row.meta,
    row.body,
    row.titleStems,
    row.headingStems,
    row.metaStems,
    row.bodyStems,
    itemId,
  ]);
};

const COLUMN_WEIGHTS = [
  SEARCH_FIELD_WEIGHTS.title,
  SEARCH_FIELD_WEIGHTS.headings,
  SEARCH_FIELD_WEIGHTS.meta,
  SEARCH_FIELD_WEIGHTS.body,
].join(", ");

// the hits alone, since a passage is cut only for the rows a page shows (`./search-hits`); a search
// answers from one side of Deleted
const SEARCH_SQL = `SELECT items.id AS id
FROM search_fts JOIN items ON items.rid = search_fts.rowid
WHERE search_fts MATCH ? AND (items.deleted_at IS NOT NULL) = ? AND items.purged = 0
ORDER BY bm25(search_fts, ${COLUMN_WEIGHTS}, ${COLUMN_WEIGHTS}), items.id
LIMIT ?`;

const hitRowSchema = z.object({ id: z.string() });

// the side of Deleted a search answers from: an item in Deleted is found only from Deleted itself
export type SearchSide = "live" | "deleted";

export interface RankedHits {
  // best first
  readonly ids: readonly string[];
  // what the index matched them by
  readonly terms: readonly SearchQueryTerm[];
}

// the search policy's plans in turn, every term required first, until one finds anything
export const searchLibrary = (
  storage: CellStorage,
  query: string,
  limit: number,
  side: SearchSide = "live",
): RankedHits => {
  for (const plan of limit > 0 ? planSearchQuery(query) : []) {
    const rows = storage.all(SEARCH_SQL, [renderFtsMatch(plan), side === "deleted" ? 1 : 0, limit]);
    if (rows.length > 0) {
      return {
        ids: rows.map((raw) => parseRow(raw, hitRowSchema, "a search hit").id),
        terms: plan.terms,
      };
    }
  }
  return { ids: [], terms: [] };
};
