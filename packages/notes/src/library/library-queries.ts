// The library's reads and writes over its one schema (`./library-schema`), as plans every engine
// runs alike. A write binds every value and cuts every many-row statement under a Durable
// Object's limits (`chunkStatement`); a user's text is matched with instr(), since a Durable
// Object refuses a pattern-match operand past 50 bytes. A row is applied only over an older one,
// and what an item's row carries (its body, links, tags and index row) lands with it or not at
// all, so a replica laying a pulled page over its own rows keeps whichever is newer, whole.

import { z } from "zod";

import { annotationEntrySchema, annotationSourceSchema } from "../annotations/store-schema";
import type { AnnotationStore } from "../annotations/store-schema";
import { renderFtsMatch } from "../knowledge/fts-match";
import { searchExcerpt } from "../knowledge/search-excerpt";
import {
  planSearchQuery,
  SEARCH_FIELD_WEIGHTS,
  stemText,
  TYPED_QUERY,
} from "../knowledge/search-query";
import type { SearchQueryOptions } from "../knowledge/search-query";
import { blockHashSchema, orderedBlocks } from "./block-ops";
import type { ItemState, StoredBlock } from "./block-ops";
import { compareBlockPlaces, ordSchema } from "./block-order";
import { canonicalJson, utf8ByteLength } from "./canonical-json";
import { deriveItem, itemCardSchema } from "./derive-item";
import type { DerivedItem, ItemCard, ItemSearchText } from "./derive-item";
import { libraryItemFieldsSchema } from "./library-item";
import type { LibraryItemFields } from "./library-item";
import { libraryBlockSchema, librarySectionSchema } from "./library-nodes";
import { LIBRARY_CHANGE_KINDS, LIBRARY_SCHEMA_VERSION } from "./library-schema";
import type { LibraryChangeKind } from "./library-schema";
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

export interface ItemRowWrite {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly derived: DerivedItem;
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
  "copy_sha",
  "fetch_state",
  "fetched_at",
  "fetch_error",
  "saved_at",
  "updated_at",
  "pinned_at",
  "deleted_at",
  "purged",
  "card",
  "schema",
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
  const { derived, fields } = write;
  const values: Record<(typeof ITEM_COLUMNS)[number], SqlValue> = {
    aliases: JSON.stringify(fields.aliases),
    author: fields.author,
    card: JSON.stringify(derived.card),
    copy_sha: fields.copySha,
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
    schema: LIBRARY_SCHEMA_VERSION,
    seq: write.seq,
    site: fields.site,
    tags: JSON.stringify(fields.tags),
    title: fields.title,
    updated_at: write.updatedAt,
    url: fields.url,
    url_key: derived.urlKey,
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
  "DELETE FROM annotations WHERE item_id = ?",
  "DELETE FROM item_blobs WHERE item_id = ?",
] as const;

const DELETE_SEARCH_ROW =
  "DELETE FROM search_fts WHERE rowid = (SELECT rid FROM items WHERE id = ?)";

const UPSERT_TOMBSTONE = `INSERT INTO items (id, purged, deleted_at, updated_at, schema, seq)
VALUES (?, 1, ?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET ${ITEM_COLUMNS.filter(
  (column) => !["id", "purged", "deleted_at", "updated_at", "schema", "seq"].includes(column),
)
  .map((column) => `${column} = NULL`)
  .join(", ")}, purged = 1, deleted_at = excluded.deleted_at, updated_at = excluded.updated_at,
  schema = excluded.schema, seq = excluded.seq
WHERE excluded.seq > items.seq
RETURNING seq`;

export interface TombstoneWrite {
  readonly id: string;
  readonly deletedAt: number;
  readonly updatedAt: number;
  readonly seq: number;
}

// a purged item: its id, sequence and deletion stay forever, and everything it held goes; whether
// it landed, since a row newer than the tombstone keeps everything it holds
export const storeTombstone = function* storeTombstone(write: TombstoneWrite): SqlPlan<boolean> {
  const landed = yield all(UPSERT_TOMBSTONE, [
    write.id,
    write.deletedAt,
    write.updatedAt,
    LIBRARY_SCHEMA_VERSION,
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
  copy_sha: z.string().nullable(),
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

export type StoredItem =
  | {
      readonly kind: "live";
      readonly id: string;
      readonly fields: LibraryItemFields;
      readonly card: ItemCard;
      readonly urlKey: string | null;
      readonly updatedAt: number;
      readonly seq: number;
    }
  | {
      readonly kind: "purged";
      readonly id: string;
      readonly deletedAt: number | null;
      readonly updatedAt: number;
      readonly seq: number;
    };

const stringList = z.array(z.string());

const storedItemOf = (raw: SqlRow): StoredItem => {
  const row = parseRow(raw, itemRowSchema, "an item");
  if (row.purged === 1) {
    return {
      deletedAt: row.deleted_at,
      id: row.id,
      kind: "purged",
      seq: row.seq,
      updatedAt: row.updated_at,
    };
  }
  const fields = libraryItemFieldsSchema.safeParse({
    aliases: parseJsonColumn(row.aliases ?? "", stringList, "an item's aliases"),
    author: row.author,
    copySha: row.copy_sha,
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

export const readItem = function* readItem(id: string): SqlPlan<StoredItem | null> {
  const [row] = yield all(`SELECT ${ITEM_COLUMNS.join(", ")} FROM items WHERE id = ?`, [id]);
  return row === undefined ? null : storedItemOf(row);
};

// ---- blocks ----

export interface BlockWrite {
  readonly stored: StoredBlock;
  readonly text: string;
  readonly annotationIds: readonly string[];
}

const BLOCK_COLUMNS = "item_id, block_id, ord, section, json, hash, text, annotation_ids, seq";

// the blocks of one write, each replacing its own row; `derived` is the item's derivation after
// the write, which gives each block its text and anchored highlights
export const blockWritesOf = (blocks: readonly StoredBlock[], derived: DerivedItem): BlockWrite[] =>
  blocks.map((stored) => {
    const own = derived.blocks.get(stored.block.id);
    return { annotationIds: own?.annotationIds ?? [], stored, text: own?.text ?? "" };
  });

// each block over its own row only when that row is older, so a pulled page never takes a block
// back; a write stores each block once, at its own sequence number
export const storeBlocks = function* storeBlocks(
  itemId: string,
  blocks: readonly BlockWrite[],
  seq: number,
): SqlPlan<void> {
  yield* runEach(
    chunkStatement({
      each: "(?, ?, ?, ?, ?, ?, ?, ?, ?)",
      head: `INSERT INTO blocks (${BLOCK_COLUMNS}) VALUES `,
      rows: blocks.map(({ annotationIds, stored, text }) => [
        itemId,
        stored.block.id,
        stored.ord,
        stored.section,
        canonicalJson(stored.block),
        stored.hash,
        text,
        JSON.stringify(annotationIds),
        seq,
      ]),
      separator: ", ",
      tail: ` ON CONFLICT (item_id, block_id) DO UPDATE SET ord = excluded.ord,
        section = excluded.section, json = excluded.json, hash = excluded.hash,
        text = excluded.text, annotation_ids = excluded.annotation_ids, seq = excluded.seq
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

// a body as a whole, under the item's row that just landed
const replaceBlocks = function* replaceBlocks(
  itemId: string,
  blocks: readonly BlockWrite[],
  seq: number,
): SqlPlan<void> {
  yield run("DELETE FROM blocks WHERE item_id = ?", [itemId]);
  yield* storeBlocks(itemId, blocks, seq);
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
      each: "(?, ?, ?, ?, ?, ?, ?, ?)",
      head: `INSERT INTO links (source_id, block_id, target_id, target_key, heading, block_ref,
        kind, section) VALUES `,
      rows: derived.links.map((link) => [
        itemId,
        link.blockId,
        link.targetId,
        link.targetKey,
        link.heading,
        link.blockRef,
        link.kind,
        link.section,
      ]),
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

// ---- a whole item ----

export interface ItemWrite {
  readonly id: string;
  readonly state: ItemState;
  readonly updatedAt: number;
  readonly seq: number;
}

// an item as a whole, with everything derived from it: what a replica lays down when an item's
// row and body arrive, and what a write that made the item stores. Null when the row held is as
// new or newer, and then nothing of the item is written.
export const storeItem = function* storeItem(write: ItemWrite): SqlPlan<DerivedItem | null> {
  const derived = deriveItem(write.state.fields, write.state.blocks);
  const landed = yield* storeItemRow({
    derived,
    fields: write.state.fields,
    id: write.id,
    seq: write.seq,
    updatedAt: write.updatedAt,
  });
  if (!landed) {
    return null;
  }
  yield* replaceBlocks(
    write.id,
    blockWritesOf(orderedBlocks(write.state.blocks), derived),
    write.seq,
  );
  yield* storeDerived(write.id, derived);
  yield* storeSearchRow(write.id, derived.search);
  return derived;
};

const COLUMN_WEIGHTS = [
  SEARCH_FIELD_WEIGHTS.title,
  SEARCH_FIELD_WEIGHTS.headings,
  SEARCH_FIELD_WEIGHTS.meta,
  SEARCH_FIELD_WEIGHTS.body,
].join(", ");

// the body comes back whole and search-excerpt cuts it, since fts5's snippet() cannot see a
// stem-only hit; an item in Deleted is not found
const SEARCH_SQL = `SELECT items.id AS id, search_fts.title AS title, search_fts.meta AS meta,
  search_fts.body AS body,
  bm25(search_fts, ${COLUMN_WEIGHTS}, ${COLUMN_WEIGHTS}) AS rank
FROM search_fts JOIN items ON items.rid = search_fts.rowid
WHERE search_fts MATCH ? AND items.deleted_at IS NULL AND items.purged = 0
ORDER BY rank, items.id
LIMIT ?`;

const searchRowSchema = z.object({
  body: z.string(),
  id: z.string(),
  meta: z.string(),
  rank: z.number(),
  title: z.string(),
});

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
  options: SearchQueryOptions = TYPED_QUERY,
): SqlPlan<LibrarySearchHit[]> {
  if (limit <= 0) {
    return [];
  }
  for (const plan of planSearchQuery(query, options)) {
    const rows = yield all(SEARCH_SQL, [renderFtsMatch(plan), limit]);
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

export interface Backlink {
  readonly sourceId: string;
  readonly blockId: string;
  readonly kind: string;
  readonly heading: string | null;
  readonly blockRef: string | null;
  readonly section: string;
}

const backlinkRowSchema = z.object({
  block_id: z.string(),
  block_ref: z.string().nullable(),
  heading: z.string().nullable(),
  kind: z.string(),
  section: z.string(),
  source_id: z.string(),
});

const BACKLINKS = `SELECT links.source_id AS source_id, links.block_id AS block_id,
  links.kind AS kind, links.heading AS heading, links.block_ref AS block_ref,
  links.section AS section
FROM links JOIN items ON items.id = links.source_id
WHERE items.deleted_at IS NULL AND items.purged = 0 AND `;

const backlinksWhere = function* backlinksWhere(
  where: string,
  params: readonly SqlValue[],
): SqlPlan<Backlink[]> {
  const rows = yield all(`${BACKLINKS}${where} ORDER BY links.source_id, links.block_id`, params);
  return rows.map((raw) => {
    const row = parseRow(raw, backlinkRowSchema, "a link");
    return {
      blockId: row.block_id,
      blockRef: row.block_ref,
      heading: row.heading,
      kind: row.kind,
      section: row.section,
      sourceId: row.source_id,
    };
  });
};

// the live items linking to an item by its id
export const linksTo = (targetId: string): SqlPlan<Backlink[]> =>
  backlinksWhere("links.target_id = ?", [targetId]);

// the live items linking to an address, by its url key: a saved link's Linked from
export const linksToUrl = (key: string): SqlPlan<Backlink[]> =>
  backlinksWhere("links.kind = 'url' AND links.target_key = ?", [key]);

// the wiki links naming a title no item held when they were written, by the title's key
export const danglingLinksTo = (key: string): SqlPlan<Backlink[]> =>
  backlinksWhere("links.kind = 'wiki' AND links.target_id IS NULL AND links.target_key = ?", [key]);

// ---- highlights ----

const annotationRowSchema = z.object({
  created_at: z.number(),
  id: z.string(),
  parent_id: z.string().nullable(),
  quote: z.string().nullable(),
  source: annotationSourceSchema.nullable(),
  text: z.string(),
  updated_at: z.number(),
});

// an item's live highlights, as the store the annotation modules fold and revert
export const readAnnotations = function* readAnnotations(itemId: string): SqlPlan<AnnotationStore> {
  const rows = yield all(
    `SELECT id, parent_id, text, quote, source, created_at, updated_at FROM annotations
     WHERE item_id = ? AND deleted_at IS NULL ORDER BY created_at, id`,
    [itemId],
  );
  return Object.fromEntries(
    rows.map((raw) => {
      const row = parseRow(raw, annotationRowSchema, "a highlight");
      return [
        row.id,
        annotationEntrySchema.parse({
          createdAt: row.created_at,
          parentId: row.parent_id ?? undefined,
          quote: row.quote ?? undefined,
          source: row.source ?? undefined,
          text: row.text,
          updatedAt: row.updated_at,
        }),
      ];
    }),
  );
};

// ---- the change log ----

export interface ChangeEntry {
  readonly kind: LibraryChangeKind;
  readonly id: string;
  readonly seq: number;
  readonly gone: boolean;
}

export const recordChanges = function* recordChanges(
  entries: readonly ChangeEntry[],
): SqlPlan<void> {
  yield* runEach(
    chunkStatement({
      each: "(?, ?, ?, ?)",
      head: "INSERT INTO changes (kind, id, seq, gone) VALUES ",
      rows: entries.map((entry) => [entry.kind, entry.id, entry.seq, entry.gone ? 1 : 0]),
      separator: ", ",
      tail: " ON CONFLICT (kind, id) DO UPDATE SET seq = excluded.seq, gone = excluded.gone",
    }),
  );
};

const changeRowSchema = z.object({
  gone: z.number(),
  id: z.string(),
  kind: z.enum(LIBRARY_CHANGE_KINDS),
  seq: z.number(),
});

export interface ChangesPage {
  readonly changes: readonly ChangeEntry[];
  // the cursor that page ends at
  readonly upto: number;
  readonly more: boolean;
}

const CHANGES_AFTER =
  "SELECT kind, id, seq, gone FROM changes WHERE seq > ? ORDER BY seq, kind, id";

const changeOf = (raw: SqlRow): ChangeEntry => {
  const row = parseRow(raw, changeRowSchema, "a change");
  return { gone: row.gone === 1, id: row.id, kind: row.kind, seq: row.seq };
};

// about `limit` changes after `cursor`, never ending inside one write: every change a write
// stamped with its sequence number rides in the same page
export const readChanges = function* readChanges(
  cursor: number,
  limit: number,
): SqlPlan<ChangesPage> {
  const first = (yield all(`${CHANGES_AFTER} LIMIT ?`, [cursor, limit])).map(changeOf);
  const last = first.at(-1);
  if (last === undefined) {
    return { changes: [], more: false, upto: cursor };
  }
  const rest = (yield all(
    "SELECT kind, id, seq, gone FROM changes WHERE seq = ? ORDER BY kind, id",
    [last.seq],
  )).map(changeOf);
  const changes = [...first.filter((entry) => entry.seq < last.seq), ...rest];
  const after = yield all("SELECT seq FROM changes WHERE seq > ? LIMIT 1", [last.seq]);
  return { changes, more: after.length > 0, upto: last.seq };
};

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
