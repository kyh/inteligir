// The library's reads and writes over its one schema (`./library-schema`), as plans every engine
// runs alike. A write binds every value and cuts every many-row statement under a Durable
// Object's limits (`chunkStatement`); a user's text is matched with instr(), since a Durable
// Object refuses a pattern-match operand past 50 bytes. A row is applied only over an older one,
// so a write stamped with a sequence the row has passed lands nothing.

import { z } from "zod";

import { renderFtsMatch } from "../knowledge/fts-match";
import { searchExcerpt } from "../knowledge/search-excerpt";
import { planSearchQuery, SEARCH_FIELD_WEIGHTS, stemText } from "../knowledge/search-query";
import { blockHashSchema, orderedBlocks } from "./block-ops";
import type { ItemState, StoredBlock } from "./block-ops";
import { compareBlockPlaces, ordSchema } from "./block-order";
import { canonicalJson, utf8ByteLength } from "./canonical-json";
import { itemCardSchema } from "./derive-item";
import type { DerivedItem, ItemCard, ItemSearchText } from "./derive-item";
import { libraryItemFieldsSchema } from "./library-item";
import type { LibraryItemFields } from "./library-item";
import { libraryBlockSchema, librarySectionSchema } from "./library-nodes";
import { all, chunkStatement, LibraryRowError, run } from "./library-sql";
import type { SqlPlan, SqlRow, SqlStatement, SqlValue } from "./library-sql";

const runEach = function* runEach(statements: readonly SqlStatement[]): SqlPlan<void> {
  for (const statement of statements) {
    yield run(statement.sql, statement.params);
  }
};

const parseJsonColumn = <T>(text: string, schema: z.ZodType<T>, what: string): T => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new LibraryRowError(`${what} is not JSON`, { cause: error });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new LibraryRowError(`${what} is not what this build writes`, { cause: parsed.error });
  }
  return parsed.data;
};

const parseRow = <T>(row: SqlRow, schema: z.ZodType<T>, what: string): T => {
  const parsed = schema.safeParse(row);
  if (!parsed.success) {
    throw new LibraryRowError(`${what} row is not what this build writes`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
};

// ---- items ----

// an item's row: its fields, and what its body says that the row carries (its card) beside the
// url key its fields give, so a listing reads the row alone
export interface ItemRowWrite {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly card: ItemCard;
  readonly urlKey: string | null;
  readonly updatedAt: number;
  readonly seq: number;
}

const ITEM_COLUMNS = [
  "id",
  "kind",
  "title",
  "folder_id",
  "aliases",
  "tags",
  "properties",
  "url",
  "url_key",
  "site",
  "author",
  "published",
  "description",
  "lang",
  "cover_sha",
  "original_sha",
  "original_name",
  "fetch_state",
  "fetched_at",
  "fetch_error",
  "saved_at",
  "updated_at",
  "pinned_at",
  "deleted_at",
  "purged",
  "card",
  "seq",
] as const;

const UPSERT_ITEM = `INSERT INTO items (${ITEM_COLUMNS.join(", ")})
VALUES (${ITEM_COLUMNS.map(() => "?").join(", ")})
ON CONFLICT (id) DO UPDATE SET ${ITEM_COLUMNS.filter((column) => column !== "id")
  .map((column) => `${column} = excluded.${column}`)
  .join(", ")}
WHERE excluded.seq > items.seq
RETURNING seq`;

// an item's row, over the one it replaces when that one is older: whether it landed, since an
// upsert whose update is skipped returns no row (https://www.sqlite.org/lang_returning.html)
export const storeItemRow = function* storeItemRow(write: ItemRowWrite): SqlPlan<boolean> {
  const { fields } = write;
  const values: Record<(typeof ITEM_COLUMNS)[number], SqlValue> = {
    aliases: JSON.stringify(fields.aliases),
    author: fields.author,
    card: JSON.stringify(write.card),
    cover_sha: fields.coverSha,
    deleted_at: fields.deletedAt,
    description: fields.description,
    fetch_error: fields.fetchError,
    fetch_state: fields.fetchState,
    fetched_at: fields.fetchedAt,
    folder_id: fields.folderId,
    id: write.id,
    kind: fields.kind,
    lang: fields.lang,
    original_name: fields.originalName,
    original_sha: fields.originalSha,
    pinned_at: fields.pinnedAt,
    properties: canonicalJson(fields.properties),
    published: fields.published,
    purged: 0,
    saved_at: fields.savedAt,
    seq: write.seq,
    site: fields.site,
    tags: JSON.stringify(fields.tags),
    title: fields.title,
    updated_at: write.updatedAt,
    url: fields.url,
    url_key: write.urlKey,
  };
  const landed = yield all(
    UPSERT_ITEM,
    ITEM_COLUMNS.map((column) => values[column]),
  );
  return landed.length > 0;
};

const ITEM_TABLES_BY_ID = [
  "DELETE FROM blocks WHERE item_id = ?",
  "DELETE FROM links WHERE source_id = ?",
  "DELETE FROM item_tags WHERE item_id = ?",
] as const;

const DELETE_SEARCH_ROW =
  "DELETE FROM search_fts WHERE rowid = (SELECT rid FROM items WHERE id = ?)";

const UPSERT_TOMBSTONE = `INSERT INTO items (id, purged, deleted_at, updated_at, seq)
VALUES (?, 1, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET ${ITEM_COLUMNS.filter(
  (column) => !["id", "purged", "deleted_at", "updated_at", "seq"].includes(column),
)
  .map((column) => `${column} = NULL`)
  .join(", ")}, purged = 1, deleted_at = excluded.deleted_at, updated_at = excluded.updated_at,
  seq = excluded.seq
WHERE excluded.seq > items.seq
RETURNING seq`;

export interface TombstoneWrite {
  readonly id: string;
  readonly deletedAt: number;
  readonly updatedAt: number;
  readonly seq: number;
}

// a purged item: its id, sequence and deletion stay forever, and everything it held goes but the
// files it named, which the cell counts for itself; whether it landed, since a row newer than the
// tombstone keeps everything it holds
export const storeTombstone = function* storeTombstone(write: TombstoneWrite): SqlPlan<boolean> {
  const landed = yield all(UPSERT_TOMBSTONE, [
    write.id,
    write.deletedAt,
    write.updatedAt,
    write.seq,
  ]);
  if (landed.length === 0) {
    return false;
  }
  yield run(DELETE_SEARCH_ROW, [write.id]);
  for (const sql of ITEM_TABLES_BY_ID) {
    yield run(sql, [write.id]);
  }
  return true;
};

const itemRowSchema = z.object({
  aliases: z.string().nullable(),
  author: z.string().nullable(),
  card: z.string().nullable(),
  cover_sha: z.string().nullable(),
  deleted_at: z.number().nullable(),
  description: z.string().nullable(),
  fetch_error: z.string().nullable(),
  fetch_state: z.string().nullable(),
  fetched_at: z.number().nullable(),
  folder_id: z.string().nullable(),
  id: z.string(),
  kind: z.string().nullable(),
  lang: z.string().nullable(),
  original_name: z.string().nullable(),
  original_sha: z.string().nullable(),
  pinned_at: z.number().nullable(),
  properties: z.string().nullable(),
  published: z.string().nullable(),
  purged: z.number(),
  saved_at: z.number().nullable(),
  seq: z.number(),
  site: z.string().nullable(),
  tags: z.string().nullable(),
  title: z.string().nullable(),
  updated_at: z.number(),
  url: z.string().nullable(),
  url_key: z.string().nullable(),
});

export interface LiveStoredItem {
  readonly kind: "live";
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly card: ItemCard;
  readonly urlKey: string | null;
  readonly updatedAt: number;
  readonly seq: number;
}

export type StoredItem =
  | LiveStoredItem
  | {
      readonly kind: "purged";
      readonly id: string;
      readonly deletedAt: number | null;
      readonly updatedAt: number;
      readonly seq: number;
    };

const stringList = z.array(z.string());

const liveItemOf = (row: z.infer<typeof itemRowSchema>): LiveStoredItem => {
  const fields = libraryItemFieldsSchema.safeParse({
    aliases: parseJsonColumn(row.aliases ?? "", stringList, "an item's aliases"),
    author: row.author,
    coverSha: row.cover_sha,
    deletedAt: row.deleted_at,
    description: row.description,
    fetchError: row.fetch_error,
    fetchState: row.fetch_state,
    fetchedAt: row.fetched_at,
    folderId: row.folder_id,
    kind: row.kind,
    lang: row.lang,
    originalName: row.original_name,
    originalSha: row.original_sha,
    pinnedAt: row.pinned_at,
    properties: parseJsonColumn(
      row.properties ?? "",
      z.record(z.string(), z.json()),
      "an item's properties",
    ),
    published: row.published,
    savedAt: row.saved_at,
    site: row.site,
    tags: parseJsonColumn(row.tags ?? "", stringList, "an item's tags"),
    title: row.title,
    url: row.url,
  });
  if (!fields.success) {
    throw new LibraryRowError("an item's fields are not what this build writes", {
      cause: fields.error,
    });
  }
  return {
    card: parseJsonColumn(row.card ?? "", itemCardSchema, "an item's card"),
    fields: fields.data,
    id: row.id,
    kind: "live",
    seq: row.seq,
    updatedAt: row.updated_at,
    urlKey: row.url_key,
  };
};

const storedItemOf = (raw: SqlRow): StoredItem => {
  const row = parseRow(raw, itemRowSchema, "an item");
  return row.purged === 1
    ? {
        deletedAt: row.deleted_at,
        id: row.id,
        kind: "purged",
        seq: row.seq,
        updatedAt: row.updated_at,
      }
    : liveItemOf(row);
};

export const readItem = function* readItem(id: string): SqlPlan<StoredItem | null> {
  const [row] = yield all(`SELECT ${ITEM_COLUMNS.join(", ")} FROM items WHERE id = ?`, [id]);
  return row === undefined ? null : storedItemOf(row);
};

// every item that is not purged, by id: what the cell's listing is built from
export const readLiveItems = function* readLiveItems(): SqlPlan<LiveStoredItem[]> {
  const rows = yield all(
    `SELECT ${ITEM_COLUMNS.join(", ")} FROM items WHERE purged = 0 ORDER BY id`,
  );
  return rows.map((raw) => liveItemOf(parseRow(raw, itemRowSchema, "an item")));
};

// ---- blocks ----

export interface BlockWrite {
  readonly stored: StoredBlock;
  readonly text: string;
}

const BLOCK_COLUMNS = "item_id, block_id, ord, section, json, hash, text, seq";

// the blocks of one write, each replacing its own row; `derived` is the item's derivation after
// the write, which gives each block its text
export const blockWritesOf = (blocks: readonly StoredBlock[], derived: DerivedItem): BlockWrite[] =>
  blocks.map((stored) => ({ stored, text: derived.blocks.get(stored.block.id)?.text ?? "" }));

// each block over its own row only when that row is older, so a block is never taken back; a
// write stores each block once, at its own sequence number
export const storeBlocks = function* storeBlocks(
  itemId: string,
  blocks: readonly BlockWrite[],
  seq: number,
): SqlPlan<void> {
  yield* runEach(
    chunkStatement({
      each: "(?, ?, ?, ?, ?, ?, ?, ?)",
      head: `INSERT INTO blocks (${BLOCK_COLUMNS}) VALUES `,
      rows: blocks.map(({ stored, text }) => [
        itemId,
        stored.block.id,
        stored.ord,
        stored.section,
        canonicalJson(stored.block),
        stored.hash,
        text,
        seq,
      ]),
      separator: ", ",
      tail: ` ON CONFLICT (item_id, block_id) DO UPDATE SET ord = excluded.ord,
        section = excluded.section, json = excluded.json, hash = excluded.hash,
        text = excluded.text, seq = excluded.seq
        WHERE excluded.seq > blocks.seq`,
    }),
  );
};

export const dropBlocks = function* dropBlocks(
  itemId: string,
  blockIds: readonly string[],
): SqlPlan<void> {
  yield* runEach(
    chunkStatement({
      each: "?",
      head: "DELETE FROM blocks WHERE item_id = ? AND block_id IN (",
      headParams: [itemId],
      rows: blockIds.map((id) => [id]),
      separator: ", ",
      tail: ")",
    }),
  );
};

const blockRowSchema = z.object({
  hash: blockHashSchema,
  json: z.string(),
  ord: ordSchema,
  section: librarySectionSchema,
});

export const readBlocks = function* readBlocks(itemId: string): SqlPlan<StoredBlock[]> {
  const rows = yield all("SELECT ord, section, json, hash FROM blocks WHERE item_id = ?", [itemId]);
  const blocks = rows.map((raw): StoredBlock => {
    const row = parseRow(raw, blockRowSchema, "a block");
    return {
      block: parseJsonColumn(row.json, libraryBlockSchema, "a block's JSON"),
      hash: row.hash,
      ord: row.ord,
      section: row.section,
    };
  });
  return orderedBlocks(new Map(blocks.map((stored) => [stored.block.id, stored])));
};

export const readItemState = function* readItemState(id: string): SqlPlan<ItemState | null> {
  const item = yield* readItem(id);
  if (item?.kind !== "live") {
    return null;
  }
  const blocks = yield* readBlocks(id);
  return {
    blocks: new Map(blocks.map((stored) => [stored.block.id, stored])),
    fields: item.fields,
  };
};

// ---- derived rows: links and tags ----

export const storeDerived = function* storeDerived(
  itemId: string,
  derived: DerivedItem,
): SqlPlan<void> {
  yield run("DELETE FROM links WHERE source_id = ?", [itemId]);
  yield* runEach(
    chunkStatement({
      each: "(?, ?, ?)",
      head: "INSERT INTO links (source_id, target_id, target_key) VALUES ",
      rows: derived.links.map((link) => [itemId, link.targetId, link.targetKey]),
      separator: ", ",
    }),
  );
  yield run("DELETE FROM item_tags WHERE item_id = ?", [itemId]);
  yield* runEach(
    chunkStatement({
      each: "(?, ?, ?)",
      head: "INSERT INTO item_tags (item_id, tag, origin) VALUES ",
      rows: derived.tags.map((tag) => [itemId, tag.tag, tag.origin]),
      separator: ", ",
      tail: " ON CONFLICT DO NOTHING",
    }),
  );
};

// ---- search ----

// a Durable Object row holds 2 MB, and an index row holds every column with its stem shadow
/** @internal */
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

/** @internal */
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

/** @internal */
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
/** @internal */
export const searchRowOf = (text: ItemSearchText): SearchRow => {
  const title = clipToBytes(text.title, TITLE_MAX_BYTES);
  const headings = clipToBytes(text.headings, HEADINGS_MAX_BYTES);
  const meta = clipToBytes(text.meta, META_MAX_BYTES);
  const fixed = {
    headingStems: stemText(headings),
    headings,
    meta,
    metaStems: stemText(meta),
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

const INSERT_SEARCH_ROW = `INSERT INTO search_fts (rowid, title, headings, meta, body, title_stems,
  heading_stems, meta_stems, body_stems)
SELECT rid, ?, ?, ?, ?, ?, ?, ?, ? FROM items WHERE id = ?`;

export const storeSearchRow = function* storeSearchRow(
  itemId: string,
  text: ItemSearchText,
): SqlPlan<void> {
  const row = searchRowOf(text);
  yield run(DELETE_SEARCH_ROW, [itemId]);
  yield run(INSERT_SEARCH_ROW, [
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

// the body comes back whole and search-excerpt cuts it, since fts5's snippet() cannot see a
// stem-only hit; a search answers from one side of Deleted
const SEARCH_SQL = `SELECT items.id AS id, search_fts.title AS title, search_fts.meta AS meta,
  search_fts.body AS body,
  bm25(search_fts, ${COLUMN_WEIGHTS}, ${COLUMN_WEIGHTS}) AS rank
FROM search_fts JOIN items ON items.rid = search_fts.rowid
WHERE search_fts MATCH ? AND (items.deleted_at IS NOT NULL) = ? AND items.purged = 0
ORDER BY rank, items.id
LIMIT ?`;

const searchRowSchema = z.object({
  body: z.string(),
  id: z.string(),
  meta: z.string(),
  rank: z.number(),
  title: z.string(),
});

// the side of Deleted a search answers from: an item in Deleted is found only from Deleted itself
export type SearchSide = "live" | "deleted";

export interface LibrarySearchHit {
  readonly itemId: string;
  readonly title: string;
  readonly snippet: string;
  // higher is better
  readonly score: number;
}

// the search policy's plans in turn, every term required first, until one finds anything
export const searchLibrary = function* searchLibrary(
  query: string,
  limit: number,
  side: SearchSide = "live",
): SqlPlan<LibrarySearchHit[]> {
  if (limit <= 0) {
    return [];
  }
  for (const plan of planSearchQuery(query)) {
    const rows = yield all(SEARCH_SQL, [renderFtsMatch(plan), side === "deleted" ? 1 : 0, limit]);
    if (rows.length > 0) {
      return rows.map((raw) => {
        const row = parseRow(raw, searchRowSchema, "a search hit");
        const snippet = searchExcerpt(row.body, plan.terms) || searchExcerpt(row.meta, plan.terms);
        return {
          itemId: row.id,
          score: -row.rank,
          snippet: snippet === "" ? row.title : snippet,
          title: row.title,
        };
      });
    }
  }
  return [];
};

// ---- literal matches ----

export interface LiteralMatch {
  readonly itemId: string;
  // the first of the item's blocks, in reading order, whose text holds the needle
  readonly text: string;
}

const matchedRowSchema = z.object({ item_id: z.string() });
const matchedPlaceSchema = z.object({
  block_id: z.string(),
  ord: z.string(),
  section: librarySectionSchema,
});
const blockTextSchema = z.object({ text: z.string() });

// the live items whose blocks hold `needle` (printable ascii, matched case-folded, since SQLite's
// lower() folds ascii alone), in id order after `after` and at most `limit` of them, each with its
// first such block's text: a line lives in one block, so a match does, and no other block's text
// is read, whatever the library holds
export const literalMatches = function* literalMatches(
  needle: string,
  page: { readonly after: string | null; readonly limit: number },
): SqlPlan<LiteralMatch[]> {
  const folded = needle.toLowerCase();
  const ids: string[] = [];
  for (const raw of yield all(
    `SELECT DISTINCT b.item_id FROM blocks b JOIN items i ON i.id = b.item_id
     WHERE b.item_id > ? AND i.deleted_at IS NULL AND i.purged = 0 AND instr(lower(b.text), ?) > 0
     ORDER BY b.item_id LIMIT ?`,
    [page.after ?? "", folded, page.limit],
  )) {
    ids.push(parseRow(raw, matchedRowSchema, "a matched item").item_id);
  }
  const matches: LiteralMatch[] = [];
  for (const itemId of ids) {
    const places = (yield all(
      "SELECT block_id, ord, section FROM blocks WHERE item_id = ? AND instr(lower(text), ?) > 0",
      [itemId, folded],
    )).map((raw) => parseRow(raw, matchedPlaceSchema, "a matched block"));
    const [first] = places
      .map((place) => ({ blockId: place.block_id, ord: place.ord, section: place.section }))
      .toSorted(compareBlockPlaces);
    if (first === undefined) {
      continue;
    }
    const [raw] = yield all("SELECT text FROM blocks WHERE item_id = ? AND block_id = ?", [
      itemId,
      first.blockId,
    ]);
    if (raw !== undefined) {
      matches.push({ itemId, text: parseRow(raw, blockTextSchema, "a block's text").text });
    }
  }
  return matches;
};

// ---- links ----

const linkSourceSchema = z.object({ source_id: z.string() });

const liveSourcesWhere = function* liveSourcesWhere(
  where: string,
  param: string,
): SqlPlan<string[]> {
  const rows = yield all(
    `SELECT DISTINCT links.source_id AS source_id
     FROM links JOIN items ON items.id = links.source_id
     WHERE items.deleted_at IS NULL AND items.purged = 0 AND ${where}
     ORDER BY links.source_id`,
    [param],
  );
  return rows.map((raw) => parseRow(raw, linkSourceSchema, "a link").source_id);
};

// the live items linking to an item by its id
export const linksTo = (targetId: string): SqlPlan<string[]> =>
  liveSourcesWhere("links.target_id = ?", targetId);

// the live items linking to an address, by its url key: a saved link's Linked from
export const linksToUrl = (key: string): SqlPlan<string[]> =>
  liveSourcesWhere("links.target_key = ?", key);

// ---- meta ----

const metaRowSchema = z.object({ v: z.union([z.string(), z.number()]).nullable() });

export const readMeta = function* readMeta(key: string): SqlPlan<string | number | null> {
  const [row] = yield all("SELECT v FROM meta WHERE k = ?", [key]);
  return row === undefined ? null : parseRow(row, metaRowSchema, "a meta").v;
};

export const writeMeta = function* writeMeta(key: string, value: string | number): SqlPlan<void> {
  yield run("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", [
    key,
    value,
  ]);
};

const headRowSchema = z.object({ v: z.number() });

// the library's next sequence number: one per write, every row it touches stamped with it
export const nextHead = function* nextHead(): SqlPlan<number> {
  const [row] = yield all(
    `INSERT INTO meta (k, v) VALUES ('head', 1) ON CONFLICT (k) DO UPDATE SET v = v + 1
     RETURNING v`,
  );
  if (row === undefined) {
    throw new LibraryRowError("the head did not come back from its own write");
  }
  return parseRow(row, headRowSchema, "the head").v;
};
