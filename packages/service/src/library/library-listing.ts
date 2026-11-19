import { ITEM_KINDS } from "@repo/contract/items/item-kind";
import type { ItemKind } from "@repo/contract/items/item-kind";
import { FolderRail } from "@repo/contract/library/folder-rail";
import {
  compareTagCounts,
  emptyKindCounts,
  itemListing,
  listedItem,
  scopeFilter,
} from "@repo/contract/library/library-index";
import type { ListingPage, ListingQuery, ListingRow } from "@repo/contract/library/library-index";
import type { listingPageInputSchema, sweptSchema } from "@repo/contract/library/library-wire";
import { compareText } from "@repo/contract/library/order-key";
import { db as pool } from "@repo/db/drizzle-client";
import type { DbExecutor, Tx } from "@repo/db/drizzle-client";
import { folder, item, itemTag } from "@repo/db/library-schema";
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
import type { z } from "zod";

import { likeLiteral, searchHits } from "../search/search-sql";
import type { SearchHits } from "../search/search-sql";
import { STORED_ITEM_COLUMNS, tagsOf } from "./library-rows";
import type { StoredItem } from "./library-rows";
import { anyOf } from "./set-sql";

export const readLibrary = async <T>(work: (tx: Tx) => Promise<T>) =>
  await pool.transaction(work, { accessMode: "read only", isolationLevel: "repeatable read" });

const ID_ORDER = sql`${item.id} collate "C"`;

const BROWSE_ORDER = {
  modified: [desc(item.pinned), desc(item.updatedAt), ID_ORDER],
  saved: [desc(item.pinned), desc(item.savedAt), ID_ORDER],
  title: [desc(item.pinned), sql`${item.titleSort} collate "C"`, ID_ORDER],
} as const;

const liveFolders = async (db: DbExecutor, accountId: string) =>
  await db
    .select({ id: folder.id, name: folder.name, parentId: folder.parentId, sort: folder.sort })
    .from(folder)
    .where(and(eq(folder.accountId, accountId), isNull(folder.deletedAt)));

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

const unsorted = or(
  isNull(item.folderId),
  notExists(
    pool
      .select({ held: sql`1` })
      .from(folder)
      .where(
        and(
          eq(folder.accountId, item.accountId),
          eq(folder.id, item.folderId),
          isNull(folder.deletedAt),
        ),
      ),
  ),
);

const folderFilter = async (
  db: DbExecutor,
  accountId: string,
  folderId: string | null | undefined,
) => {
  if (folderId === undefined) {
    return;
  }

  if (folderId === null) {
    return unsorted;
  }

  const tree = new FolderRail(await liveFolders(db, accountId)).tree(folderId);

  return tree.size === 0 ? sql`false` : inArray(item.folderId, [...tree]);
};

const pinnedFilter = (pinned: boolean | undefined) => {
  if (pinned === undefined) {
    return;
  }

  return pinned ? isNotNull(item.pinnedAt) : isNull(item.pinnedAt);
};

type ListingFilter = Pick<
  ListingQuery,
  "beforeMs" | "deleted" | "folderId" | "pinned" | "sinceMs" | "tag"
>;

const filterOf = async (db: DbExecutor, accountId: string, query: ListingFilter) =>
  and(
    eq(item.accountId, accountId),
    query.deleted ? isNotNull(item.deletedAt) : isNull(item.deletedAt),
    await folderFilter(db, accountId, query.folderId),
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

export const listingPage = async (
  db: DbExecutor,
  accountId: string,
  input: z.output<typeof listingPageInputSchema>,
) => {
  const filter = scopeFilter(input.scope);

  const hits: SearchHits | null =
    input.words === undefined
      ? null
      : await searchHits(db, accountId, input.words, filter.deleted ? "deleted" : "live");

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
  const rail = new FolderRail(await liveFolders(db, accountId));

  const byFolder = await db
    .select({
      deleted: sql<number>`count(*) filter (where ${item.deletedAt} is not null)`.mapWith(Number),
      folderId: item.folderId,
      live: sql<number>`count(*) filter (where ${item.deletedAt} is null)`.mapWith(Number),
    })
    .from(item)
    .where(eq(item.accountId, accountId))
    .groupBy(item.folderId);

  const direct = new Map<string, number>();
  let deleted = 0;
  let total = 0;
  let unsortedItems = 0;

  for (const row of byFolder) {
    deleted += row.deleted;
    total += row.live;

    if (row.folderId !== null && rail.has(row.folderId)) {
      direct.set(row.folderId, row.live);
    } else {
      unsortedItems += row.live;
    }
  }

  const itemOfTag = and(eq(item.accountId, itemTag.accountId), eq(item.id, itemTag.itemId));
  const liveTags = and(eq(itemTag.accountId, accountId), isNull(item.deletedAt));

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
    deleted,
    folders: rail.counted(direct),
    tags: tags.toSorted(compareTagCounts),
    total,
    unsorted: unsortedItems,
    untagged: total - (tagged?.items ?? 0),
  };
};

export const listingTitles = async (db: DbExecutor, accountId: string) => ({
  targets: await db
    .select({ id: item.id, title: sql<string>`${item.card}->>'title'` })
    .from(item)
    .where(and(eq(item.accountId, accountId), isNull(item.deletedAt)))
    .orderBy(...BROWSE_ORDER.title),
});
