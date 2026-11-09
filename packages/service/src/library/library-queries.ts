// The library's reads and writes over the cell's schema (`@repo/db/cell/schema`): an item's row,
// its derived rows and `meta` through drizzle's builders, and its blocks and the search index as
// raw plans (`./library-sql`). A write binds every value and cuts every many-row statement under a
// Durable Object's limits (`insertChunks`, `chunkStatement`); a user's text is matched with
// instr(), since a Durable Object refuses a pattern-match operand past 50 bytes. A row is applied
// only over an older one, so a write stamped with a sequence the row has passed lands nothing.

import { and, asc, eq, getColumns, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import { items, itemTags, links, meta } from "@repo/db/cell/schema";
import { renderFtsMatch } from "../knowledge/fts-match";
import { searchExcerpt } from "../knowledge/search-excerpt";
import { planSearchQuery, SEARCH_FIELD_WEIGHTS, stemText } from "../knowledge/search-query";
import { blockHashSchema, orderedBlocks } from "@repo/contract/library/block-ops";
import type { ItemState, StoredBlock } from "@repo/contract/library/block-ops";
import { compareBlockPlaces, ordSchema } from "@repo/contract/library/block-order";
import { canonicalJson, utf8ByteLength } from "@repo/contract/library/canonical-json";
import { itemCardSchema } from "@repo/contract/library/derive-item";
import type { DerivedItem, ItemCard, ItemSearchText } from "@repo/contract/library/derive-item";
import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { libraryBlockSchema, librarySectionSchema } from "@repo/contract/library/library-nodes";
import { all, chunkStatement, LibraryRowError, run, runPlan } from "./library-sql";
import type { SqlPlan, SqlRow, SqlStatement } from "./library-sql";

import { excluded, insertChunks } from "./cell-db";
import type { CellDb } from "./cell-db";
import type { CellStorage } from "./cell-storage";

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

// every column a write replaces: all but the row's own ids
const REPLACED = Object.entries(getColumns(items)).filter(([key]) => key !== "rid" && key !== "id");

const ITEM_UPSERT = Object.fromEntries(REPLACED.map(([key, column]) => [key, excluded(column)]));

// an upsert whose update is skipped returns no row (https://www.sqlite.org/lang_returning.html)
const newerThanHeld = sql`${excluded(items.seq)} > ${items.seq}`;

// an item's row, over the one it replaces when that one is older: whether it landed
export const storeItemRow = (db: CellDb, write: ItemRowWrite): boolean => {
  const { fields } = write;
  const landed = db
    .insert(items)
    .values({
      aliases: JSON.stringify(fields.aliases),
      author: fields.author,
      card: JSON.stringify(write.card),
      coverSha: fields.coverSha,
      deletedAt: fields.deletedAt,
      description: fields.description,
      fetchError: fields.fetchError,
      fetchState: fields.fetchState,
      fetchedAt: fields.fetchedAt,
      folderId: fields.folderId,
      id: write.id,
      kind: fields.kind,
      lang: fields.lang,
      originalName: fields.originalName,
      originalSha: fields.originalSha,
      pinnedAt: fields.pinnedAt,
      properties: canonicalJson(fields.properties),
      published: fields.published,
      purged: 0,
      savedAt: fields.savedAt,
      seq: write.seq,
      site: fields.site,
      tags: JSON.stringify(fields.tags),
      title: fields.title,
      updatedAt: write.updatedAt,
      url: fields.url,
      urlKey: write.urlKey,
    })
    .onConflictDoUpdate({ set: ITEM_UPSERT, setWhere: newerThanHeld, target: items.id })
    .returning({ seq: items.seq })
    .all();
  return landed.length > 0;
};

// a tombstone takes its deletion, time and sequence, and nulls every other column it replaces
const TOMBSTONE_TAKES: ReadonlySet<string> = new Set(["purged", "deletedAt", "updatedAt", "seq"]);
const TOMBSTONE_UPSERT = Object.fromEntries(
  REPLACED.map(([key, column]) => [key, TOMBSTONE_TAKES.has(key) ? excluded(column) : sql`NULL`]),
);

const DELETE_SEARCH_ROW =
  "DELETE FROM search_fts WHERE rowid = (SELECT rid FROM items WHERE id = ?)";

export interface TombstoneWrite {
  readonly id: string;
  readonly deletedAt: number;
  readonly updatedAt: number;
  readonly seq: number;
}

// a purged item: its id, sequence and deletion stay forever, and everything it held goes but the
// files it named, which the cell counts for itself; whether it landed, since a row newer than the
// tombstone keeps everything it holds
export const storeTombstone = (storage: CellStorage, write: TombstoneWrite): boolean => {
  const { db } = storage;
  const landed = db
    .insert(items)
    .values({
      deletedAt: write.deletedAt,
      id: write.id,
      purged: 1,
      seq: write.seq,
      updatedAt: write.updatedAt,
    })
    .onConflictDoUpdate({ set: TOMBSTONE_UPSERT, setWhere: newerThanHeld, target: items.id })
    .returning({ seq: items.seq })
    .all();
  if (landed.length === 0) {
    return false;
  }
  storage.run(DELETE_SEARCH_ROW, [write.id]);
  storage.run("DELETE FROM blocks WHERE item_id = ?", [write.id]);
  db.delete(links).where(eq(links.sourceId, write.id)).run();
  db.delete(itemTags).where(eq(itemTags.itemId, write.id)).run();
  return true;
};

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

type ItemRow = typeof items.$inferSelect;

const liveItemOf = (row: ItemRow): LiveStoredItem => {
  const fields = libraryItemFieldsSchema.safeParse({
    aliases: parseJsonColumn(row.aliases ?? "", stringList, "an item's aliases"),
    author: row.author,
    coverSha: row.coverSha,
    deletedAt: row.deletedAt,
    description: row.description,
    fetchError: row.fetchError,
    fetchState: row.fetchState,
    fetchedAt: row.fetchedAt,
    folderId: row.folderId,
    kind: row.kind,
    lang: row.lang,
    originalName: row.originalName,
    originalSha: row.originalSha,
    pinnedAt: row.pinnedAt,
    properties: parseJsonColumn(
      row.properties ?? "",
      z.record(z.string(), z.json()),
      "an item's properties",
    ),
    published: row.published,
    savedAt: row.savedAt,
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
    updatedAt: row.updatedAt,
    urlKey: row.urlKey,
  };
};

const storedItemOf = (row: ItemRow): StoredItem =>
  row.purged === 1
    ? {
        deletedAt: row.deletedAt,
        id: row.id,
        kind: "purged",
        seq: row.seq,
        updatedAt: row.updatedAt,
      }
    : liveItemOf(row);

export const readItem = (db: CellDb, id: string): StoredItem | null => {
  const row = db.select().from(items).where(eq(items.id, id)).get();
  return row === undefined ? null : storedItemOf(row);
};

// every item that is not purged, by id: what the cell's listing is built from
export const readLiveItems = (db: CellDb): LiveStoredItem[] =>
  db.select().from(items).where(eq(items.purged, 0)).orderBy(asc(items.id)).all().map(liveItemOf);

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

export const readItemState = (storage: CellStorage, id: string): ItemState | null => {
  const item = readItem(storage.db, id);
  if (item?.kind !== "live") {
    return null;
  }
  const blocks = runPlan(storage, readBlocks(id));
  return {
    blocks: new Map(blocks.map((stored) => [stored.block.id, stored])),
    fields: item.fields,
  };
};

// ---- derived rows: links and tags ----

export const storeDerived = (db: CellDb, itemId: string, derived: DerivedItem): void => {
  db.delete(links).where(eq(links.sourceId, itemId)).run();
  const linkRows = derived.links.map((link) => ({
    sourceId: itemId,
    targetId: link.targetId,
    targetKey: link.targetKey,
  }));
  for (const chunk of insertChunks(links, linkRows)) {
    db.insert(links).values(chunk).run();
  }
  db.delete(itemTags).where(eq(itemTags.itemId, itemId)).run();
  const tagRows = derived.tags.map((tag) => ({ itemId, origin: tag.origin, tag: tag.tag }));
  for (const chunk of insertChunks(itemTags, tagRows)) {
    db.insert(itemTags).values(chunk).onConflictDoNothing().run();
  }
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

const liveSourcesWhere = (db: CellDb, where: SQL): string[] =>
  db
    .selectDistinct({ sourceId: links.sourceId })
    .from(links)
    .innerJoin(items, eq(items.id, links.sourceId))
    .where(and(isNull(items.deletedAt), eq(items.purged, 0), where))
    .orderBy(asc(links.sourceId))
    .all()
    .map((row) => row.sourceId);

// the live items linking to an item by its id
export const linksTo = (db: CellDb, targetId: string): string[] =>
  liveSourcesWhere(db, eq(links.targetId, targetId));

// the live items linking to an address, by its url key: a saved link's Linked from
export const linksToUrl = (db: CellDb, key: string): string[] =>
  liveSourcesWhere(db, eq(links.targetKey, key));

// ---- meta ----

export const readMeta = (db: CellDb, key: string): string | number | null =>
  db.select({ v: meta.v }).from(meta).where(eq(meta.k, key)).get()?.v ?? null;

export const writeMeta = (db: CellDb, key: string, value: string | number): void => {
  db.insert(meta)
    .values({ k: key, v: value })
    .onConflictDoUpdate({ set: { v: excluded(meta.v) }, target: meta.k })
    .run();
};

const headSchema = z.number().int().positive();

// the library's next sequence number: one per write, every row it touches stamped with it
export const nextHead = (db: CellDb): number => {
  const [row] = db
    .insert(meta)
    .values({ k: "head", v: 1 })
    .onConflictDoUpdate({ set: { v: sql`${meta.v} + 1` }, target: meta.k })
    .returning({ v: meta.v })
    .all();
  if (row === undefined) {
    throw new LibraryRowError("the head did not come back from its own write");
  }
  return headSchema.parse(row.v);
};
