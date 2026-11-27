import type {
  BodyBlock,
  BodyDigest,
  DerivedBody,
  DerivedItem,
  ItemCard,
} from "@repo/contract/library/derive-item";
import { titleKey } from "@repo/contract/library/derive-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { bodyBytes } from "@repo/contract/library/library-wire";
import type { DbExecutor } from "@repo/db/drizzle-client";
import type { itemSearch } from "@repo/db/library-schema";
import { item, itemBody, itemTag, libraryState } from "@repo/db/library-schema";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { searchVectorOf } from "../search/search-vector";
import type { SearchText } from "../search/search-vector";

export interface StoredItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly card: ItemCard;
  readonly urlKey: string | null;
  readonly updatedAt: number;
  readonly seq: number;
}

export interface StoredBody {
  readonly version: number;
  readonly blocks: readonly BodyBlock[];
  readonly digest: BodyDigest;
}

type ItemRow = typeof item.$inferInsert;

export const itemRowOf = (accountId: string, stored: StoredItem) =>
  ({
    ...stored.fields,
    accountId,
    aliasKeys: [...new Set(stored.fields.aliases.map((alias) => titleKey(alias)))].filter(
      (key) => key !== "",
    ),
    card: stored.card,
    id: stored.id,
    seq: stored.seq,
    titleKey: titleKey(stored.card.title),
    titleSort: stored.card.title.toLowerCase(),
    updatedAt: stored.updatedAt,
    urlKey: stored.urlKey,
  }) satisfies ItemRow;

const FIELD_COLUMNS = {
  aliases: item.aliases,
  author: item.author,
  coverSha: item.coverSha,
  deletedAt: item.deletedAt,
  description: item.description,
  editedSha: item.editedSha,
  parentId: item.parentId,
  kind: item.kind,
  lang: item.lang,
  list: item.list,
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

export const STORED_ITEM_COLUMNS = {
  card: item.card,
  fields: FIELD_COLUMNS,
  id: item.id,
  seq: item.seq,
  updatedAt: item.updatedAt,
  urlKey: item.urlKey,
};

export const readItem = async (db: DbExecutor, accountId: string, id: string) => {
  const [row] = await db
    .select(STORED_ITEM_COLUMNS)
    .from(item)
    .where(and(eq(item.accountId, accountId), eq(item.id, id)));

  return row ?? null;
};

export const liveItemAt = async (db: DbExecutor, accountId: string, urlKey: string) => {
  const [row] = await db
    .select(STORED_ITEM_COLUMNS)
    .from(item)
    .where(and(eq(item.accountId, accountId), eq(item.urlKey, urlKey), isNull(item.deletedAt)));

  return row ?? null;
};

export const readBodyFacts = async (db: DbExecutor, accountId: string, itemId: string) => {
  const [row] = await db
    .select({ digest: itemBody.digest, version: itemBody.version })
    .from(itemBody)
    .where(and(eq(itemBody.accountId, accountId), eq(itemBody.itemId, itemId)));

  return row ?? null;
};

const withBody = and(eq(itemBody.accountId, item.accountId), eq(itemBody.itemId, item.id));

export const readItemRow = async (db: DbExecutor, accountId: string, id: string) => {
  const [row] = await db
    .select({ ...STORED_ITEM_COLUMNS, bodyVersion: itemBody.version })
    .from(item)
    .innerJoin(itemBody, withBody)
    .where(and(eq(item.accountId, accountId), eq(item.id, id)));

  if (row === undefined) {
    return null;
  }

  const { bodyVersion, ...stored } = row;

  return { bodyVersion, item: stored } satisfies {
    readonly item: StoredItem;
    readonly bodyVersion: number;
  } | null;
};

export const readItemWhole = async (db: DbExecutor, accountId: string, id: string) => {
  const [row] = await db
    .select({ ...STORED_ITEM_COLUMNS, blocks: itemBody.blocks, bodyVersion: itemBody.version })
    .from(item)
    .innerJoin(itemBody, withBody)
    .where(and(eq(item.accountId, accountId), eq(item.id, id)));

  if (row === undefined) {
    return null;
  }

  const { blocks, bodyVersion, ...stored } = row;

  return { blocks, bodyVersion, item: stored } satisfies {
    readonly item: StoredItem;
    readonly blocks: readonly BodyBlock[];
    readonly bodyVersion: number;
  } | null;
};

export const tagsOf = async (db: DbExecutor, accountId: string, itemIds: readonly string[]) => {
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

export const libraryHead = async (db: DbExecutor, accountId: string) => {
  const [row] = await db
    .select({ head: libraryState.head })
    .from(libraryState)
    .where(eq(libraryState.accountId, accountId));

  return row?.head ?? 0;
};

export const bodyRowOf = (accountId: string, itemId: string, body: StoredBody) =>
  ({
    ...body,
    accountId,
    bytes: bodyBytes(body.blocks),
    itemId,
  }) satisfies typeof itemBody.$inferInsert;

export const searchRowOf = (accountId: string, itemId: string, text: SearchText) =>
  ({
    accountId,
    itemId,
    text: text.body,
    vec: searchVectorOf(text),
  }) satisfies typeof itemSearch.$inferInsert;

export const tagRowsOf = (accountId: string, itemId: string, tags: DerivedItem["tags"]) =>
  tags.map(({ origin, tag }) => ({ accountId, itemId, origin, tag, tagKey: tag.toLowerCase() }));

export const linkRowsOf = (accountId: string, sourceId: string, links: DerivedBody["links"]) => {
  const targets = new Map(links.map((link) => [link.targetId ?? link.targetKey, link]));

  return [...targets.values()].map(({ targetId, targetKey }) => ({
    accountId,
    sourceId,
    targetId,
    targetKey,
  }));
};
