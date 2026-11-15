// The library's reads and writes over the cell's schema (`@repo/db/cell/schema`): an item's row,
// its derived rows and `meta`, through drizzle's builders. A write binds every value and cuts every
// many-row statement under a Durable Object's limits (`insertChunks`). A row is applied only over
// an older one, so a write stamped with a sequence the row has passed lands nothing.

import { and, asc, eq, getColumns, gt, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import {
  BODY_HOMES,
  bodyTexts,
  items,
  itemTags,
  links,
  meta,
  seedBlocks,
} from "@repo/db/cell/schema";
import { canonicalJson } from "@repo/contract/library/canonical-json";
import { bodyDigestSchema, itemCardSchema } from "@repo/contract/library/derive-item";
import type {
  BodyDigest,
  DerivedLink,
  DerivedTag,
  ItemCard,
} from "@repo/contract/library/derive-item";
import type { ItemKind } from "@repo/contract/items/item-kind";
import type { ListingRow } from "@repo/contract/library/library-index";
import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { dropSearchRow } from "../search/search-index";
import { LibraryRowError } from "./library-sql";

import { excluded, insertChunks } from "./cell-db";
import type { CellDb } from "./cell-db";
import type { CellStorage } from "./cell-storage";

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

// an item's row: its fields, and what its body says that the row carries (its card) beside the
// url key its fields give, so a listing reads the row alone
export interface ItemRowWrite {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly body: ItemBody;
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
      bodyBytes: write.body.bytes,
      bodyDigest: JSON.stringify(write.body.digest),
      bodyHome: write.body.home,
      bodyVersion: write.body.version,
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

export interface TombstoneWrite {
  readonly id: string;
  readonly deletedAt: number;
  readonly updatedAt: number;
  readonly seq: number;
}

// a purged item: its id, sequence and deletion stay forever, and everything it held goes but the
// files it named, which the cell counts for itself, and its note, which a job empties; whether it landed, since a row newer than the
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
  dropSearchRow(storage, write.id);
  db.delete(seedBlocks).where(eq(seedBlocks.itemId, write.id)).run();
  db.delete(bodyTexts).where(eq(bodyTexts.itemId, write.id)).run();
  db.delete(links).where(eq(links.sourceId, write.id)).run();
  db.delete(itemTags).where(eq(itemTags.itemId, write.id)).run();
  return true;
};

export interface LiveStoredItem {
  readonly kind: "live";
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly body: ItemBody;
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
  const home = BODY_HOMES.find((one) => one === row.bodyHome);
  if (home === undefined || row.bodyVersion === null || row.bodyBytes === null) {
    throw new LibraryRowError(`the item ${row.id} keeps no body`);
  }
  return {
    body: {
      bytes: row.bodyBytes,
      digest: parseJsonColumn(row.bodyDigest ?? "", bodyDigestSchema, "an item's body digest"),
      home,
      version: row.bodyVersion,
    },
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

// the item while it is not purged, in Deleted or not
export const readLiveItem = (db: CellDb, id: string): LiveStoredItem | null => {
  const item = readItem(db, id);
  return item?.kind === "live" ? item : null;
};

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

type ListingColumns = Omit<ListingFacts, "kind" | "savedAt"> & {
  readonly kind: ItemKind | null;
  readonly savedAt: number | null;
};

const factsOf = ({ kind, savedAt, ...facts }: ListingColumns): ListingFacts => {
  if (kind === null || savedAt === null) {
    throw new LibraryRowError(`the item ${facts.id} is not what this build writes`);
  }
  return { ...facts, kind, savedAt };
};

// every item that is not purged, by id: what the cell's listing is built from
export const readListingRows = (db: CellDb): ListingFacts[] =>
  db
    .select(LISTING_COLUMNS)
    .from(items)
    .where(eq(items.purged, 0))
    .orderBy(asc(items.id))
    .all()
    .map(factsOf);

// what a write moved of the listing: an item's facts, or its id once it is purged
export type ListingChange =
  | { readonly kind: "live"; readonly facts: ListingFacts }
  | { readonly kind: "purged"; readonly id: string };

// every item a write stamped past `since`, by id: what a listing held since then is caught up from
export const readListingSince = (db: CellDb, since: number): ListingChange[] =>
  db
    .select({ ...LISTING_COLUMNS, purged: items.purged })
    .from(items)
    .where(gt(items.seq, since))
    .orderBy(asc(items.id))
    .all()
    .map(({ purged, ...row }) =>
      purged === 1 ? { id: row.id, kind: "purged" } : { facts: factsOf(row), kind: "live" },
    );

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

const instantSchema = z.number().int().nonnegative();

// a meta key holding a time or a count, null before its first write
export const readInstant = (db: CellDb, key: string): number | null => {
  const held = readMeta(db, key);
  return held === null ? null : instantSchema.parse(held);
};

// a meta key holding a count, 0 before its first write
export const readCount = (db: CellDb, key: string): number => readInstant(db, key) ?? 0;

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
