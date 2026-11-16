// The library's reads and writes over the cell's schema (`@repo/db/cell/schema`): an item's row,
// its derived rows and the cell's one row, through drizzle's builders. A write binds every value and
// cuts every many-row statement under a Durable Object's limits (`insertChunks`).

import { and, asc, eq, getColumns, gt, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import type { BODY_HOMES } from "@repo/db/cell/schema";
import {
  bodyTexts,
  cellState,
  items,
  itemTags,
  links,
  purgedItems,
  seedBlocks,
} from "@repo/db/cell/schema";
import type {
  BodyDigest,
  DerivedLink,
  DerivedTag,
  ItemCard,
} from "@repo/contract/library/derive-item";
import type { ListingRow } from "@repo/contract/library/library-index";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { dropSearchRow } from "../search/search-index";
import { LibraryRowError } from "./library-sql";

import { excluded, insertChunks } from "./cell-db";
import type { CellDb } from "./cell-db";

// ---- items ----

// Where an item's body lives and what the row keeps of it: `seed`, the cell's own rows until its note
// first opens, or `note`, its live document, of which the cell holds the projection landed at
// `version`; the digest its card and index derive from, and the bytes the note's object holds
export interface ItemBody {
  readonly home: (typeof BODY_HOMES)[number];
  readonly digest: BodyDigest;
  readonly version: number;
  readonly bytes: number;
}

// an item as the library holds it, in Deleted or not: its fields, its body, and what its body says
// that the row carries (its card) beside the url key its fields give, so a listing reads the row
// alone
export interface StoredItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly body: ItemBody;
  readonly card: ItemCard;
  readonly urlKey: string | null;
  readonly updatedAt: number;
  readonly seq: number;
}

// every column a write replaces: all but the row's own ids
const ITEM_UPSERT = Object.fromEntries(
  Object.entries(getColumns(items))
    .filter(([key]) => key !== "rid" && key !== "id")
    .map(([key, column]) => [key, excluded(column)]),
);

// an item's row, over the one it held
export const storeItemRow = (db: CellDb, item: StoredItem): void => {
  const { body } = item;
  db.insert(items)
    .values({
      ...item.fields,
      bodyBytes: body.bytes,
      bodyDigest: body.digest,
      bodyHome: body.home,
      bodyVersion: body.version,
      card: item.card,
      id: item.id,
      seq: item.seq,
      updatedAt: item.updatedAt,
      urlKey: item.urlKey,
    })
    .onConflictDoUpdate({ set: ITEM_UPSERT, target: items.id })
    .run();
};

// an item emptied from Deleted: its row and everything derived from it go but the files it named,
// which the cell lets go for itself, and its note, which a job empties; its id stays, purged at
// the purge's sequence
export const purgeItem = (db: CellDb, id: string, seq: number): void => {
  for (const { rid } of db
    .delete(items)
    .where(eq(items.id, id))
    .returning({ rid: items.rid })
    .all()) {
    dropSearchRow(db, rid);
  }
  db.delete(seedBlocks).where(eq(seedBlocks.itemId, id)).run();
  db.delete(bodyTexts).where(eq(bodyTexts.itemId, id)).run();
  db.delete(links).where(eq(links.sourceId, id)).run();
  db.delete(itemTags).where(eq(itemTags.itemId, id)).run();
  db.insert(purgedItems).values({ id, seq }).run();
};

// an item's fields, one column each
const FIELD_COLUMNS = {
  aliases: items.aliases,
  author: items.author,
  coverSha: items.coverSha,
  deletedAt: items.deletedAt,
  description: items.description,
  folderId: items.folderId,
  kind: items.kind,
  lang: items.lang,
  originalName: items.originalName,
  originalSha: items.originalSha,
  pinnedAt: items.pinnedAt,
  properties: items.properties,
  published: items.published,
  reading: items.reading,
  savedAt: items.savedAt,
  site: items.site,
  tags: items.tags,
  title: items.title,
  url: items.url,
} satisfies Record<keyof LibraryItemFields, AnySQLiteColumn>;

const STORED_COLUMNS = {
  body: {
    bytes: items.bodyBytes,
    digest: items.bodyDigest,
    home: items.bodyHome,
    version: items.bodyVersion,
  },
  card: items.card,
  fields: FIELD_COLUMNS,
  id: items.id,
  seq: items.seq,
  updatedAt: items.updatedAt,
  urlKey: items.urlKey,
};

// the item, in Deleted or not; null for an id no item holds, a purged one's included
export const readItem = (db: CellDb, id: string): StoredItem | null =>
  db.select(STORED_COLUMNS).from(items).where(eq(items.id, id)).get() ?? null;

// whether the library made the id already: an item holds it, or a purged one kept it
export const idTaken = (db: CellDb, id: string): boolean =>
  db.select({ id: items.id }).from(items).where(eq(items.id, id)).get() !== undefined ||
  db.select({ id: purgedItems.id }).from(purgedItems).where(eq(purgedItems.id, id)).get() !==
    undefined;

// what the cell's listing reads of an item's row: the facts it filters and orders by, the card's
// title taken out in SQL, since parsing every row whole was most of a listing's cost
export type ListingFacts = Omit<ListingRow, "tags">;

const LISTING_COLUMNS = {
  deletedAt: items.deletedAt,
  folderId: items.folderId,
  id: items.id,
  kind: items.kind,
  pinnedAt: items.pinnedAt,
  savedAt: items.savedAt,
  title: sql`json_extract(${items.card}, '$.title')`.mapWith(String),
  updatedAt: items.updatedAt,
  url: items.url,
};

// every item, by id: what the cell's listing is built from
export const readListingRows = (db: CellDb): ListingFacts[] =>
  db.select(LISTING_COLUMNS).from(items).orderBy(asc(items.id)).all();

// what the writes stamped past `since` moved of the listing: the items they wrote, by id, and the
// ids they purged
export const readListingSince = (db: CellDb, since: number) => ({
  items: db
    .select(LISTING_COLUMNS)
    .from(items)
    .where(gt(items.seq, since))
    .orderBy(asc(items.id))
    .all(),
  purged: db
    .select({ id: purgedItems.id })
    .from(purgedItems)
    .where(gt(purgedItems.seq, since))
    .all()
    .map((row) => row.id),
});

// ---- derived rows: links and tags ----

export const storeLinks = (db: CellDb, itemId: string, derived: readonly DerivedLink[]): void => {
  db.delete(links).where(eq(links.sourceId, itemId)).run();
  const linkRows = derived.map((link) => ({
    sourceId: itemId,
    targetId: link.targetId,
    targetKey: link.targetKey,
  }));
  for (const chunk of insertChunks(links, linkRows)) {
    db.insert(links).values(chunk).run();
  }
};

export const storeTags = (db: CellDb, itemId: string, tags: readonly DerivedTag[]): void => {
  db.delete(itemTags).where(eq(itemTags.itemId, itemId)).run();
  const tagRows = tags.map((tag) => ({ itemId, origin: tag.origin, tag: tag.tag }));
  for (const chunk of insertChunks(itemTags, tagRows)) {
    db.insert(itemTags).values(chunk).onConflictDoNothing().run();
  }
};

// ---- links ----

const liveSourcesWhere = (db: CellDb, where: SQL): string[] =>
  db
    .selectDistinct({ sourceId: links.sourceId })
    .from(links)
    .innerJoin(items, eq(items.id, links.sourceId))
    .where(and(isNull(items.deletedAt), where))
    .orderBy(asc(links.sourceId))
    .all()
    .map((row) => row.sourceId);

// the live items linking to an item by its id
export const linksTo = (db: CellDb, targetId: string): string[] =>
  liveSourcesWhere(db, eq(links.targetId, targetId));

// the live items linking to an address, by its url key: a saved link's Linked from
export const linksToUrl = (db: CellDb, key: string): string[] =>
  liveSourcesWhere(db, eq(links.targetKey, key));

// ---- the cell's one row ----

// what the cell holds once; undefined before its first write, when each is as its column defaults
export const readCellState = (db: CellDb) =>
  db.select().from(cellState).where(eq(cellState.slot, 1)).get();

export const writeCellState = (
  db: CellDb,
  facts: Partial<Pick<typeof cellState.$inferInsert, "blobRemovals" | "deletedAt" | "rules">>,
): void => {
  db.insert(cellState)
    .values({ ...facts, slot: 1 })
    .onConflictDoUpdate({ set: facts, target: cellState.slot })
    .run();
};

// the library's next sequence number: one per write, every row it touches stamped with it
export const nextHead = (db: CellDb): number => {
  const [row] = db
    .insert(cellState)
    .values({ head: 1, slot: 1 })
    .onConflictDoUpdate({ set: { head: sql`${cellState.head} + 1` }, target: cellState.slot })
    .returning({ head: cellState.head })
    .all();
  if (row === undefined) {
    throw new LibraryRowError("the head did not come back from its own write");
  }
  return row.head;
};
