import { CONTAINER_KINDS, ITEM_KINDS } from "@repo/contract/items/item-kind";
import type { ItemKind } from "@repo/contract/items/item-kind";
import { ItemTree } from "@repo/contract/library/item-tree";
import {
  compareTagCounts,
  emptyKindCounts,
  itemListing,
  listedItem,
  scopeFilter,
  treeChildrenOf,
} from "@repo/contract/library/library-index";
import type { ListingPage, ListingQuery, ListingRow } from "@repo/contract/library/library-index";
import type { listingPageInputSchema, sweptSchema } from "@repo/contract/library/library-wire";
import { compareText } from "@repo/contract/library/order-key";
import { db as pool } from "@repo/db/drizzle-client";
import type { DbExecutor, Tx } from "@repo/db/drizzle-client";
import { item, itemTag } from "@repo/db/library-schema";
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  not,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";

import { likeLiteral, searchHits } from "../search/search-sql";
import type { SearchHits } from "../search/search-sql";
import { STORED_ITEM_COLUMNS, tagsOf } from "./library-rows";
import type { StoredItem } from "./library-rows";
import { anyOf } from "./set-sql";
import { nearItem, nearWords } from "../meaning/meaning-sql";

export const readLibrary = async <T>(work: (tx: Tx) => Promise<T>) =>
  await pool.transaction(work, { accessMode: "read only", isolationLevel: "repeatable read" });

const ID_ORDER = sql`${item.id} collate "C"`;

const BROWSE_ORDER = {
  modified: [desc(item.pinned), desc(item.updatedAt), ID_ORDER],
  saved: [desc(item.pinned), desc(item.savedAt), ID_ORDER],
  title: [desc(item.pinned), sql`${item.titleSort} collate "C"`, ID_ORDER],
} as const;

const PARENT_KINDS = ["folder", "list", "note"] as const satisfies readonly ItemKind[];

const CARD_TITLE = sql<string>`${item.card}->>'title'`;

const liveTree = async (db: DbExecutor, accountId: string) =>
  new ItemTree(
    await db
      .select({ id: item.id, kind: item.kind, parentId: item.parentId, title: CARD_TITLE })
      .from(item)
      .where(
        and(
          eq(item.accountId, accountId),
          isNull(item.deletedAt),
          inArray(item.kind, [...PARENT_KINDS]),
        ),
      ),
  );

const notContainer = not(inArray(item.kind, [...CONTAINER_KINDS]));

const inTagFamily = (tag: string) => {
  const key = tag.toLowerCase();
  const under = `${likeLiteral(key)}/%`;

  return exists(
    pool
      .select({ held: sql`1` })
      .from(itemTag)
      .where(
        and(
          eq(itemTag.accountId, item.accountId),
          eq(itemTag.itemId, item.id),
          or(eq(itemTag.tagKey, key), sql`${itemTag.tagKey} like ${under} escape '\\'`),
        ),
      ),
  );
};

const parentItem = alias(item, "parent_item");

const atRoot = or(
  isNull(item.parentId),
  eq(item.parentId, item.id),
  notExists(
    pool
      .select({ held: sql`1` })
      .from(parentItem)
      .where(
        and(
          eq(parentItem.accountId, item.accountId),
          eq(parentItem.id, item.parentId),
          isNull(parentItem.deletedAt),
          inArray(parentItem.kind, [...PARENT_KINDS]),
        ),
      ),
  ),
);

const parentFilter = async (
  db: DbExecutor,
  accountId: string,
  parentId: string | null | undefined,
) => {
  if (parentId === undefined) {
    return;
  }

  if (parentId === null) {
    return atRoot;
  }

  const tree = await liveTree(db, accountId);
  const within = tree.subtree(parentId);

  return within.size === 0
    ? sql`false`
    : and(inArray(item.parentId, [...within]), sql`${item.parentId} <> ${item.id}`);
};

const pinnedFilter = (pinned: boolean | undefined) => {
  if (pinned === undefined) {
    return;
  }

  return pinned ? isNotNull(item.pinnedAt) : isNull(item.pinnedAt);
};

type ListingFilter = Pick<
  ListingQuery,
  "beforeMs" | "deleted" | "parentId" | "pinned" | "sinceMs" | "tag"
>;

const filterOf = async (db: DbExecutor, accountId: string, query: ListingFilter) =>
  and(
    eq(item.accountId, accountId),
    query.deleted ? isNotNull(item.deletedAt) : and(isNull(item.deletedAt), notContainer),
    await parentFilter(db, accountId, query.parentId),
    query.tag === undefined ? undefined : inTagFamily(query.tag),
    pinnedFilter(query.pinned),
    query.sinceMs === undefined ? undefined : gte(item.savedAt, query.sinceMs),
    query.beforeMs === undefined ? undefined : lt(item.savedAt, query.beforeMs),
  );

const asListings = async (db: DbExecutor, accountId: string, rows: readonly StoredItem[]) => {
  const tags = await tagsOf(
    db,
    accountId,
    rows.map(({ id }) => id),
  );

  return rows.map((row) => itemListing(row, tags.get(row.id) ?? []));
};

const selectStored = (db: DbExecutor) => db.select(STORED_ITEM_COLUMNS).from(item);

const kindsOf = (query: ListingQuery) => query.kinds ?? ITEM_KINDS;

const pageOf = <R extends ListingRow>(
  rows: readonly R[],
  query: ListingQuery,
  total: number,
  kindCounts: Record<ItemKind, number>,
) => {
  const end = query.offset + query.limit;

  return {
    items: rows,
    kindCounts,
    next: end < total ? end : null,
    total,
  } satisfies ListingPage<R>;
};

const browsePage = async (
  db: DbExecutor,
  accountId: string,
  query: ListingQuery & { readonly order: { readonly by: keyof typeof BROWSE_ORDER } },
) => {
  const filter = await filterOf(db, accountId, query);

  const counted = await db
    .select({ items: count(), kind: item.kind })
    .from(item)
    .where(filter)
    .groupBy(item.kind);

  const kindCounts = emptyKindCounts();

  for (const { items, kind } of counted) {
    kindCounts[kind] = items;
  }

  const kinds = kindsOf(query);
  const total = kinds.reduce((sum, kind) => sum + kindCounts[kind], 0);

  const rows =
    query.offset >= total
      ? []
      : await selectStored(db)
          .where(
            and(filter, query.kinds === undefined ? undefined : inArray(item.kind, [...kinds])),
          )
          .orderBy(...BROWSE_ORDER[query.order.by])
          .limit(query.limit)
          .offset(query.offset);

  return pageOf(await asListings(db, accountId, rows), query, total, kindCounts);
};

const rankedPage = async (
  db: DbExecutor,
  accountId: string,
  query: ListingQuery,
  rank: ReadonlyMap<string, number>,
) => {
  if (rank.size === 0) {
    return pageOf([], query, 0, emptyKindCounts());
  }

  const filter = await filterOf(db, accountId, query);
  const hits = await selectStored(db).where(and(filter, inArray(item.id, [...rank.keys()])));
  const kindCounts = emptyKindCounts();

  for (const hit of hits) {
    kindCounts[hit.fields.kind] += 1;
  }

  const kinds = new Set(kindsOf(query));
  const placeOf = (id: string) => rank.get(id) ?? rank.size;

  const ordered = hits
    .filter((hit) => kinds.has(hit.fields.kind))
    .toSorted(
      (a, b) =>
        Number(a.fields.pinnedAt === null) - Number(b.fields.pinnedAt === null) ||
        placeOf(a.id) - placeOf(b.id) ||
        b.fields.savedAt - a.fields.savedAt ||
        compareText(a.id, b.id),
    );

  const rows = ordered.slice(query.offset, query.offset + query.limit);

  return pageOf(await asListings(db, accountId, rows), query, ordered.length, kindCounts);
};

export const listingItems = async (db: DbExecutor, accountId: string, query: ListingQuery) =>
  query.order.by === "rank"
    ? await rankedPage(db, accountId, query, query.order.rank)
    : await browsePage(db, accountId, { ...query, order: query.order });

const MEANING_HITS = 50;

const withMeaning = (hits: SearchHits, near: readonly string[]) => {
  const rank = new Map(hits.rank);

  for (const id of near) {
    if (!rank.has(id)) {
      rank.set(id, rank.size);
    }
  }

  return { ...hits, rank } satisfies SearchHits;
};

export const relatedItems = async (
  db: DbExecutor,
  accountId: string,
  id: string,
  limit: number,
) => {
  const near = await nearItem(db, accountId, id, limit);
  const place = new Map(near.map((at, index) => [at, index]));

  const rows =
    near.length === 0
      ? []
      : await selectStored(db).where(and(eq(item.accountId, accountId), anyOf(item.id, near)));

  const ordered = rows.toSorted(
    (a, b) => (place.get(a.id) ?? place.size) - (place.get(b.id) ?? place.size),
  );

  const listed = await asListings(db, accountId, ordered);

  return { items: listed.map((row) => listedItem(row)) };
};

export const listingPage = async (
  db: DbExecutor,
  accountId: string,
  input: z.output<typeof listingPageInputSchema>,
) => {
  const filter = scopeFilter(input.scope);

  const lexical: SearchHits | null =
    input.words === undefined
      ? null
      : await searchHits(db, accountId, input.words, filter.deleted ? "deleted" : "live");

  const hits =
    lexical !== null && input.words !== undefined && input.meaning && !filter.deleted
      ? withMeaning(lexical, await nearWords(db, accountId, input.words, MEANING_HITS))
      : lexical;

  const page = await listingItems(db, accountId, {
    ...filter,
    kinds: input.kinds,
    limit: input.limit,
    offset: input.cursor,
    order: hits === null ? { by: input.sort } : { by: "rank", rank: hits.rank },
  });

  const passages = hits === null ? null : await hits.passages(page.items);

  return {
    cursor: page.next,
    items: page.items.map((row) =>
      listedItem(row, passages === null ? undefined : (passages.get(row.id) ?? row.title)),
    ),
    kindCounts: page.kindCounts,
    total: page.total,
  };
};

export const sweptItems = async (
  db: DbExecutor,
  accountId: string,
  swept: z.output<typeof sweptSchema>,
) => {
  const rows = await db
    .select({ deletedAt: item.deletedAt, id: item.id })
    .from(item)
    .where(
      and(
        await filterOf(db, accountId, scopeFilter(swept.scope)),
        swept.kinds === undefined ? undefined : inArray(item.kind, [...swept.kinds]),
        swept.except.length === 0 ? undefined : not(anyOf(item.id, swept.except)),
      ),
    );

  return rows.map(({ deletedAt, id }) => ({ deleted: deletedAt !== null, id }));
};

export const listingScopes = async (db: DbExecutor, accountId: string) => {
  const tree = await liveTree(db, accountId);

  const byParent = await db
    .select({
      deleted: sql<number>`count(*) filter (where ${item.deletedAt} is not null)`.mapWith(Number),
      live: sql<number>`count(*) filter (where ${item.deletedAt} is null and ${notContainer})`.mapWith(
        Number,
      ),
      parentId: item.parentId,
    })
    .from(item)
    .where(eq(item.accountId, accountId))
    .groupBy(item.parentId);

  const direct = new Map<string, number>();
  let deleted = 0;
  let total = 0;
  let unsortedItems = 0;

  for (const row of byParent) {
    deleted += row.deleted;
    total += row.live;

    if (row.parentId !== null && tree.has(row.parentId)) {
      direct.set(row.parentId, row.live);
    } else {
      unsortedItems += row.live;
    }
  }

  const itemOfTag = and(eq(item.accountId, itemTag.accountId), eq(item.id, itemTag.itemId));
  const liveTags = and(eq(itemTag.accountId, accountId), isNull(item.deletedAt), notContainer);

  const tags = await db
    .select({
      items: countDistinct(itemTag.itemId),
      tag: sql<string>`(array_agg(${itemTag.tag} order by ${item.pinned} desc, ${item.savedAt} desc, ${item.id} collate "C", ${itemTag.tag} collate "C"))[1]`,
    })
    .from(itemTag)
    .innerJoin(item, itemOfTag)
    .where(liveTags)
    .groupBy(itemTag.tagKey);

  const [tagged] = await db
    .select({ items: countDistinct(itemTag.itemId) })
    .from(itemTag)
    .innerJoin(item, itemOfTag)
    .where(liveTags);

  return {
    containers: tree.containers(direct),
    deleted,
    tags: tags.toSorted(compareTagCounts),
    total,
    unsorted: unsortedItems,
    untagged: total - (tagged?.items ?? 0),
  };
};

export const listingChildren = async (
  db: DbExecutor,
  accountId: string,
  parentId: string | null,
) => {
  const tree = await liveTree(db, accountId);
  const under = alias(item, "under");

  const notes = await db
    .select({
      hasChildren: exists(
        pool
          .select({ held: sql`1` })
          .from(under)
          .where(
            and(
              eq(under.accountId, item.accountId),
              eq(under.parentId, item.id),
              eq(under.kind, "note"),
              isNull(under.deletedAt),
            ),
          ),
      ).mapWith(Boolean),
      id: item.id,
      kind: item.kind,
      parentId: item.parentId,
      title: CARD_TITLE,
    })
    .from(item)
    .where(and(eq(item.accountId, accountId), isNull(item.deletedAt), eq(item.kind, "note")));

  const placed = notes.filter((row) => tree.liveParentOf(row.parentId, row.id) === parentId);
  const parents = new Set(placed.flatMap((row) => (row.hasChildren ? [row.id] : [])));

  return treeChildrenOf(placed, parents);
};

export const listingTitles = async (db: DbExecutor, accountId: string) => ({
  targets: await db
    .select({ id: item.id, title: sql<string>`${item.card}->>'title'` })
    .from(item)
    .where(and(eq(item.accountId, accountId), isNull(item.deletedAt), notContainer))
    .orderBy(...BROWSE_ORDER.title),
});
