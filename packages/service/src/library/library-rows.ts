// An item's rows as the library model spells them, and back: its row from its fields and what
// derives from them, its body's, its search row's, its tags' and its links'. Times are milliseconds
// in both and JSON is typed by its column, so a mapping is mostly the identity. Every read takes
// the account, since one shared database is a predicate away from another account's rows.

import { utf8ByteLength } from "@repo/contract/library/canonical-json";
import type {
  BodyBlock,
  BodyDigest,
  DerivedBody,
  DerivedItem,
  ItemCard,
} from "@repo/contract/library/derive-item";
import { titleKey } from "@repo/contract/library/derive-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { DbExecutor } from "@repo/db/drizzle-client";
import type { itemLink, itemSearch } from "@repo/db/library-schema";
import { item, itemBody, itemTag, libraryState } from "@repo/db/library-schema";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { searchVectorOf } from "../search/search-vector";
import type { SearchText } from "../search/search-vector";

// an item as the library holds it, in Deleted or not: its fields, and what its row derives beside
// them, so a listing reads the row alone
export interface StoredItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly card: ItemCard;
  readonly urlKey: string | null;
  readonly updatedAt: number;
  readonly seq: number;
}

// an item's body: `version` moves with each write of it, and `digest` is what its card and search
// row derive from, so a write of the fields alone reads no blocks
export interface StoredBody {
  readonly version: number;
  readonly blocks: readonly BodyBlock[];
  readonly digest: BodyDigest;
}

type ItemRow = typeof item.$inferInsert;

export const itemRowOf = (accountId: string, stored: StoredItem): ItemRow => ({
  ...stored.fields,
  accountId,
  // a key no title can name is filed under none
  aliasKeys: [...new Set(stored.fields.aliases.map((alias) => titleKey(alias)))].filter(
    (key) => key !== "",
  ),
  card: stored.card,
  id: stored.id,
  seq: stored.seq,
  titleKey: titleKey(stored.fields.title),
  // case never orders a listing by title
  titleSort: stored.card.title.toLowerCase(),
  updatedAt: stored.updatedAt,
  urlKey: stored.urlKey,
});

const FIELD_COLUMNS = {
  aliases: item.aliases,
  author: item.author,
  coverSha: item.coverSha,
  deletedAt: item.deletedAt,
  description: item.description,
  folderId: item.folderId,
  kind: item.kind,
  lang: item.lang,
  originalName: item.originalName,
  originalSha: item.originalSha,
  pinnedAt: item.pinnedAt,
  properties: item.properties,
  published: item.published,
  reading: item.reading,
  savedAt: item.savedAt,
  site: item.site,
  tags: item.tags,
  title: item.title,
  url: item.url,
} satisfies Record<keyof LibraryItemFields, PgColumn>;

// what a select of an item reads back as its `StoredItem`
export const STORED_ITEM_COLUMNS = {
  card: item.card,
  fields: FIELD_COLUMNS,
  id: item.id,
  seq: item.seq,
  updatedAt: item.updatedAt,
  urlKey: item.urlKey,
};

// the item, in Deleted or not; null for an id the account holds no item under
export const readItem = async (
  db: DbExecutor,
  accountId: string,
  id: string,
): Promise<StoredItem | null> => {
  const [row] = await db
    .select(STORED_ITEM_COLUMNS)
    .from(item)
    .where(and(eq(item.accountId, accountId), eq(item.id, id)));
  return row ?? null;
};

// the one live item at an address, by its url's key; null while none holds it
export const liveItemAt = async (
  db: DbExecutor,
  accountId: string,
  urlKey: string,
): Promise<StoredItem | null> => {
  const [row] = await db
    .select(STORED_ITEM_COLUMNS)
    .from(item)
    .where(and(eq(item.accountId, accountId), eq(item.urlKey, urlKey), isNull(item.deletedAt)));
  return row ?? null;
};

// the body's version and digest, without its blocks: what a write of the fields alone derives from
export const readBodyFacts = async (
  db: DbExecutor,
  accountId: string,
  itemId: string,
): Promise<Omit<StoredBody, "blocks"> | null> => {
  const [row] = await db
    .select({ digest: itemBody.digest, version: itemBody.version })
    .from(itemBody)
    .where(and(eq(itemBody.accountId, accountId), eq(itemBody.itemId, itemId)));
  return row ?? null;
};

const withBody = and(eq(itemBody.accountId, item.accountId), eq(itemBody.itemId, item.id));

// the item and the version its body stands at, without its blocks; null for an id the account
// holds no item under
export const readItemRow = async (
  db: DbExecutor,
  accountId: string,
  id: string,
): Promise<{ readonly item: StoredItem; readonly bodyVersion: number } | null> => {
  const [row] = await db
    .select({ ...STORED_ITEM_COLUMNS, bodyVersion: itemBody.version })
    .from(item)
    .innerJoin(itemBody, withBody)
    .where(and(eq(item.accountId, accountId), eq(item.id, id)));
  if (row === undefined) {
    return null;
  }
  const { bodyVersion, ...stored } = row;
  return { bodyVersion, item: stored };
};

// the item and its blocks in reading order at the version they stand at, read in one statement so
// no write splits them; null for an id the account holds no item under
export const readItemWhole = async (
  db: DbExecutor,
  accountId: string,
  id: string,
): Promise<{
  readonly item: StoredItem;
  readonly blocks: readonly BodyBlock[];
  readonly bodyVersion: number;
} | null> => {
  const [row] = await db
    .select({ ...STORED_ITEM_COLUMNS, blocks: itemBody.blocks, bodyVersion: itemBody.version })
    .from(item)
    .innerJoin(itemBody, withBody)
    .where(and(eq(item.accountId, accountId), eq(item.id, id)));
  if (row === undefined) {
    return null;
  }
  const { blocks, bodyVersion, ...stored } = row;
  return { blocks, bodyVersion, item: stored };
};

// each tag the items carry, their field's and their body's, each spelling once, in byte order, as
// a list names them
export const tagsOf = async (
  db: DbExecutor,
  accountId: string,
  itemIds: readonly string[],
): Promise<Map<string, string[]>> => {
  const tags = new Map<string, string[]>();
  if (itemIds.length === 0) {
    return tags;
  }
  const rows = await db
    .select({ itemId: itemTag.itemId, tag: itemTag.tag })
    .from(itemTag)
    .where(and(eq(itemTag.accountId, accountId), inArray(itemTag.itemId, [...itemIds])))
    .orderBy(asc(itemTag.itemId), asc(sql`${itemTag.tag} collate "C"`));
  for (const { itemId, tag } of rows) {
    const held = tags.get(itemId) ?? [];
    if (held.at(-1) !== tag) {
      tags.set(itemId, [...held, tag]);
    }
  }
  return tags;
};

// the sequence the library's last write took, 0 before its first
export const libraryHead = async (db: DbExecutor, accountId: string): Promise<number> => {
  const [row] = await db
    .select({ head: libraryState.head })
    .from(libraryState)
    .where(eq(libraryState.accountId, accountId));
  return row?.head ?? 0;
};

// its blocks as JSON in UTF-8, which the quota counts and the body's cap is measured in
export const bodyRowOf = (
  accountId: string,
  itemId: string,
  body: StoredBody,
): typeof itemBody.$inferInsert => ({
  ...body,
  accountId,
  bytes: utf8ByteLength(JSON.stringify(body.blocks)),
  itemId,
});

export const searchRowOf = (
  accountId: string,
  itemId: string,
  text: SearchText,
): typeof itemSearch.$inferInsert => ({
  accountId,
  itemId,
  text: text.body,
  vec: searchVectorOf(text),
});

export const tagRowsOf = (
  accountId: string,
  itemId: string,
  tags: DerivedItem["tags"],
): (typeof itemTag.$inferInsert)[] =>
  tags.map(({ origin, tag }) => ({ accountId, itemId, origin, tag, tagKey: tag.toLowerCase() }));

// each target once, as a body naming an item twice links it once
export const linkRowsOf = (
  accountId: string,
  sourceId: string,
  links: DerivedBody["links"],
): (typeof itemLink.$inferInsert)[] => {
  const targets = new Map(links.map((link) => [link.targetId ?? link.targetKey, link]));
  return [...targets.values()].map(({ targetId, targetKey }) => ({
    accountId,
    sourceId,
    targetId,
    targetKey,
  }));
};
