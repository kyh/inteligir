// The ranked index, `search_fts`: FTS5, which sqlite-core cannot declare, so it is declared beside
// the cell's handle (`../library/cell-db`) and its MATCH and rank are fragments. It ranks and keeps
// no text, which is `body_texts`'s. The cell keeps an item's row in code, beside the item's own,
// never by a trigger, and a search asks it by the one policy (`./search-query`).

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { items } from "@repo/db/cell/schema";
import { utf8ByteLength } from "@repo/contract/library/canonical-json";
import type { ItemSearchText } from "@repo/contract/library/derive-item";

import { searchFts } from "../library/cell-db";
import type { CellDb } from "../library/cell-db";
import { renderFtsMatch } from "./fts-match";
import { planSearchQuery, SEARCH_FIELD_WEIGHTS, stemText } from "./search-query";
import type { SearchQueryTerm } from "./search-query";

// a Durable Object binds a value of at most 2 MB, so a long item ranks by its body's opening
const VALUE_MAX_BYTES = 1_900_000;
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

// an item's row gone from the index, as a purge or a rewrite leaves it, by the item's `rid`
export const dropSearchRow = (db: CellDb, rid: number): void => {
  db.delete(searchFts).where(eq(searchFts.rowid, rid)).run();
};

type SearchRow = Omit<typeof searchFts.$inferInsert, "rowid">;

// an item's index row, each column and its stems a value the object binds: a fold can lengthen a
// column past it, since Hangul decomposes to three times its bytes
export const searchRowOf = (text: ItemSearchText): SearchRow => {
  const title = clipToBytes(text.title, TITLE_MAX_BYTES);
  const headings = clipToBytes(text.headings, HEADINGS_MAX_BYTES);
  const meta = clipToBytes(text.meta, META_MAX_BYTES);
  const body = clipToBytes(text.body, VALUE_MAX_BYTES);
  const stems = (column: string): string => clipToBytes(stemText(column), VALUE_MAX_BYTES);
  return {
    body,
    bodyStems: stems(body),
    headingStems: stems(headings),
    headings,
    meta,
    metaStems: stems(meta),
    title,
    titleStems: stems(title),
  };
};

// an item's row in the index, replaced whole under its `rid`
export const storeSearchRow = (db: CellDb, itemId: string, text: ItemSearchText): void => {
  const item = db.select({ rid: items.rid }).from(items).where(eq(items.id, itemId)).get();
  if (item === undefined) {
    return;
  }
  dropSearchRow(db, item.rid);
  db.insert(searchFts)
    .values({ rowid: item.rid, ...searchRowOf(text) })
    .run();
};

const COLUMN_WEIGHTS = sql.raw(
  [
    SEARCH_FIELD_WEIGHTS.title,
    SEARCH_FIELD_WEIGHTS.headings,
    SEARCH_FIELD_WEIGHTS.meta,
    SEARCH_FIELD_WEIGHTS.body,
  ].join(", "),
);

// fts5's rank of a hit, lower the better, each column weighed beside its stem shadow
const RANK = sql`bm25(${searchFts}, ${COLUMN_WEIGHTS}, ${COLUMN_WEIGHTS})`;

// the side of Deleted a search answers from: an item in Deleted is found only from Deleted itself
export type SearchSide = "live" | "deleted";

export interface RankedHits {
  // best first
  readonly ids: readonly string[];
  // what the index matched them by
  readonly terms: readonly SearchQueryTerm[];
}

// the search policy's plans in turn, every term required first, until one finds anything; the hits
// alone, since a passage is cut only for the rows a page shows (`./search-hits`)
export const searchLibrary = (
  db: CellDb,
  query: string,
  limit: number,
  side: SearchSide = "live",
): RankedHits => {
  for (const plan of limit > 0 ? planSearchQuery(query) : []) {
    const rows = db
      .select({ id: items.id })
      .from(searchFts)
      .innerJoin(items, eq(items.rid, searchFts.rowid))
      .where(
        and(
          sql`${searchFts} MATCH ${renderFtsMatch(plan)}`,
          side === "deleted" ? isNotNull(items.deletedAt) : isNull(items.deletedAt),
          eq(items.purged, 0),
        ),
      )
      .orderBy(RANK, asc(items.id))
      .limit(limit)
      .all();
    if (rows.length > 0) {
      return { ids: rows.map((row) => row.id), terms: plan.terms };
    }
  }
  return { ids: [], terms: [] };
};
