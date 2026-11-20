import type { z } from "zod";

import type { ItemKind } from "../items/item-kind";
import type { LibraryScope } from "../library-scope";
import type { ItemCard } from "./derive-item";
import type { LibraryItemFields } from "./library-item";
import type {
  itemSummarySchema,
  listedItemSchema,
  listingPageInputSchema,
  sweptSchema,
  tagCountSchema,
} from "./library-wire";
import { listingSortSchema } from "./listing-sort";
import { FolderRail } from "./folder-rail";
import type { ListingFolder } from "./folder-rail";
import { compareText } from "./order-key";

export interface ListingRow {
  readonly id: string;
  readonly kind: ItemKind;
  readonly title: string;
  readonly folderId: string | null;
  readonly tags: readonly string[];
  readonly url: string | null;
  readonly savedAt: number;
  readonly updatedAt: number;
  readonly pinnedAt: number | null;
  readonly deletedAt: number | null;
}

type ListingSort = z.infer<typeof listingSortSchema>;

type SearchRanks = ReadonlyMap<string, number>;

export interface ListingQuery {
  readonly deleted: boolean;
  readonly kinds?: readonly ItemKind[];
  readonly tag?: string;
  readonly folderId?: string | null;
  readonly pinned?: boolean;
  readonly sinceMs?: number;
  readonly beforeMs?: number;
  readonly order:
    | { readonly by: ListingSort }
    | { readonly by: "rank"; readonly rank: SearchRanks };
  readonly limit: number;
  readonly offset: number;
}

export interface ListingPage<R extends ListingRow> {
  readonly items: readonly R[];
  readonly total: number;
  readonly next: number | null;
  readonly kindCounts: Readonly<Record<ItemKind, number>>;
}

type TagCount = z.infer<typeof tagCountSchema>;

interface Entry<R extends ListingRow> {
  readonly row: R;
  readonly tagKeys: readonly string[];
}

export const emptyKindCounts = () =>
  ({
    audio: 0,
    file: 0,
    image: 0,
    link: 0,
    note: 0,
    pdf: 0,
    video: 0,
  }) satisfies Record<ItemKind, number>;

const inTagFamily = (tagKeys: readonly string[], tag: string) => {
  const key = tag.toLowerCase();

  return tagKeys.some((held) => held === key || held.startsWith(`${key}/`));
};

const pinRank = (row: ListingRow) => (row.pinnedAt === null ? 1 : 0);

const bySort = (a: ListingRow, b: ListingRow, sort: ListingSort) => {
  switch (sort) {
    case "saved": {
      return b.savedAt - a.savedAt;
    }

    case "modified": {
      return b.updatedAt - a.updatedAt;
    }

    case "title": {
      return compareText(a.title.toLowerCase(), b.title.toLowerCase());
    }

    default: {
      throw new Error(`unexpected ${String(sort satisfies never)}`);
    }
  }
};

export const compareTagCounts = (a: TagCount, b: TagCount) =>
  b.items - a.items || compareText(a.tag.toLowerCase(), b.tag.toLowerCase());

export class LibraryIndex<R extends ListingRow> {
  private readonly entries = new Map<string, Entry<R>>();
  private readonly sorted = new Map<string, readonly string[]>();
  private rail = new FolderRail([]);

  upsert(row: R) {
    const prior = this.entries.get(row.id)?.row;
    this.entries.set(row.id, { row, tagKeys: row.tags.map((tag) => tag.toLowerCase()) });

    if (
      prior === undefined ||
      prior.deletedAt !== row.deletedAt ||
      prior.pinnedAt !== row.pinnedAt
    ) {
      this.sorted.clear();

      return;
    }

    for (const sort of listingSortSchema.options) {
      if (bySort(prior, row, sort) !== 0) {
        this.dropSort(sort);
      }
    }
  }

  remove(id: string) {
    if (this.entries.delete(id)) {
      this.sorted.clear();
    }
  }

  setFolders(folders: readonly ListingFolder[]) {
    this.rail = new FolderRail(folders);
  }

  items(query: ListingQuery) {
    const kinds = query.kinds === undefined ? null : new Set(query.kinds);

    const order =
      query.order.by === "rank"
        ? this.rankOrder(query.deleted, query.order.rank)
        : this.membersSorted(query.deleted, query.order.by);

    const folderIds =
      query.folderId === undefined || query.folderId === null
        ? null
        : this.rail.tree(query.folderId);

    const kindCounts = emptyKindCounts();
    const matched: R[] = [];

    for (const id of order) {
      const entry = this.entries.get(id);

      if (entry === undefined || !this.passes(entry, query, folderIds)) {
        continue;
      }

      kindCounts[entry.row.kind] += 1;

      if (kinds === null || kinds.has(entry.row.kind)) {
        matched.push(entry.row);
      }
    }

    const end = query.offset + query.limit;

    return {
      items: matched.slice(query.offset, end),
      kindCounts,
      next: end < matched.length ? end : null,
      total: matched.length,
    } satisfies ListingPage<R>;
  }

  scopes() {
    const direct = new Map<string, number>();
    const tags = new Map<string, TagCount>();
    let total = 0;
    let unsorted = 0;
    let untagged = 0;

    for (const row of this.rowsOf(this.membersSorted(false, "saved"))) {
      total += 1;

      if (row.tags.length === 0) {
        untagged += 1;
      }

      const counted = new Set<string>();

      for (const tag of row.tags) {
        const key = tag.toLowerCase();

        if (!counted.has(key)) {
          counted.add(key);
          const held = tags.get(key);
          tags.set(key, { items: (held?.items ?? 0) + 1, tag: held?.tag ?? tag });
        }
      }

      const folderId = this.liveFolderOf(row);

      if (folderId === null) {
        unsorted += 1;
      } else {
        direct.set(folderId, (direct.get(folderId) ?? 0) + 1);
      }
    }

    let deleted = 0;

    for (const { row } of this.entries.values()) {
      if (row.deletedAt !== null) {
        deleted += 1;
      }
    }

    return {
      deleted,
      folders: this.rail.counted(direct),
      tags: [...tags.values()].toSorted(compareTagCounts),
      total,
      unsorted,
      untagged,
    };
  }

  titles() {
    return {
      targets: this.rowsOf(this.membersSorted(false, "title")).map(({ id, title }) => ({
        id,
        title,
      })),
    };
  }

  private rowsOf(ids: readonly string[]) {
    return ids.flatMap((id) => this.entries.get(id)?.row ?? []);
  }

  private liveFolderOf(row: ListingRow) {
    return row.folderId !== null && this.rail.has(row.folderId) ? row.folderId : null;
  }

  private passes(entry: Entry<R>, query: ListingQuery, folderIds: ReadonlySet<string> | null) {
    const { row } = entry;
    const folderId = this.liveFolderOf(row);

    return (
      (query.folderId !== null || folderId === null) &&
      (folderIds === null || (folderId !== null && folderIds.has(folderId))) &&
      (query.tag === undefined || inTagFamily(entry.tagKeys, query.tag)) &&
      (query.pinned === undefined || (row.pinnedAt !== null) === query.pinned) &&
      (query.sinceMs === undefined || row.savedAt >= query.sinceMs) &&
      (query.beforeMs === undefined || row.savedAt < query.beforeMs)
    );
  }

  private dropSort(sort: ListingSort) {
    this.sorted.delete(`live:${sort}`);
    this.sorted.delete(`deleted:${sort}`);
  }

  private membersSorted(deleted: boolean, sort: ListingSort) {
    const cacheKey = `${deleted ? "deleted" : "live"}:${sort}`;
    const cached = this.sorted.get(cacheKey);

    if (cached !== undefined) {
      return cached;
    }

    const order = [...this.entries.values()]
      .flatMap(({ row }) => ((row.deletedAt !== null) === deleted ? [row] : []))
      .toSorted((a, b) => pinRank(a) - pinRank(b) || bySort(a, b, sort) || compareText(a.id, b.id))
      .map((row) => row.id);

    this.sorted.set(cacheKey, order);

    return order;
  }

  private rankOrder(deleted: boolean, ranks: SearchRanks) {
    return [...ranks.keys()]
      .flatMap((id) => {
        const row = this.entries.get(id)?.row;

        return row === undefined || (row.deletedAt !== null) !== deleted ? [] : [row];
      })
      .toSorted(
        (a, b) =>
          pinRank(a) - pinRank(b) ||
          (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0) ||
          b.savedAt - a.savedAt ||
          compareText(a.id, b.id),
      )
      .map((row) => row.id);
  }
}

export interface ItemListing extends ListingRow {
  readonly card: ItemCard;
  readonly fields: LibraryItemFields;
  readonly seq: number;
}

export const itemListing = (
  item: {
    readonly id: string;
    readonly fields: LibraryItemFields;
    readonly card: ItemCard;
    readonly seq: number;
    readonly updatedAt: number;
  },
  tags: readonly string[],
) =>
  ({
    card: item.card,
    deletedAt: item.fields.deletedAt,
    fields: item.fields,
    folderId: item.fields.folderId,
    id: item.id,
    kind: item.fields.kind,
    pinnedAt: item.fields.pinnedAt,
    savedAt: item.fields.savedAt,
    seq: item.seq,
    tags,
    title: item.card.title,
    updatedAt: item.updatedAt,
    url: item.fields.url,
  }) satisfies ItemListing;

export const answerCard = (card: ItemCard) => ({ ...card, outline: [...card.outline] });

type ListedItem = z.infer<typeof listedItemSchema>;

export const listedItem = (row: ItemListing, snippet?: string) => {
  const listed: ListedItem = {
    card: answerCard(row.card),
    fields: row.fields,
    id: row.id,
    seq: row.seq,
    tags: [...row.tags],
    updatedAt: row.updatedAt,
  };

  if (snippet !== undefined) {
    listed.snippet = snippet;
  }

  return listed;
};

export interface SearchHits {
  readonly rank: SearchRanks;
  readonly passage: (id: string) => string | null;
}

export const scopeFilter = (scope: LibraryScope) => {
  switch (scope.kind) {
    case "all": {
      return { deleted: false } satisfies Pick<ListingQuery, "deleted" | "folderId" | "tag">;
    }

    case "unsorted": {
      return { deleted: false, folderId: null } satisfies Pick<
        ListingQuery,
        "deleted" | "folderId" | "tag"
      >;
    }

    case "folder": {
      return { deleted: false, folderId: scope.folderId } satisfies Pick<
        ListingQuery,
        "deleted" | "folderId" | "tag"
      >;
    }

    case "tag": {
      return { deleted: false, tag: scope.tag } satisfies Pick<
        ListingQuery,
        "deleted" | "folderId" | "tag"
      >;
    }

    case "deleted": {
      return { deleted: true } satisfies Pick<ListingQuery, "deleted" | "folderId" | "tag">;
    }

    default: {
      throw new Error(`unexpected ${String(scope satisfies never)}`);
    }
  }
};

export const listingPageOf = <R extends ListingRow>(
  index: LibraryIndex<R>,
  input: z.output<typeof listingPageInputSchema>,
  search: (words: string, deleted: boolean) => SearchHits,
  whole: (row: R) => ItemListing,
) => {
  const filter = scopeFilter(input.scope);
  const hits = input.words === undefined ? null : search(input.words, filter.deleted);

  const page = index.items({
    ...filter,
    kinds: input.kinds,
    limit: input.limit,
    offset: input.cursor,
    order: hits === null ? { by: input.sort } : { by: "rank", rank: hits.rank },
  });

  return {
    cursor: page.next,
    items: page.items.map((row) =>
      listedItem(whole(row), hits === null ? undefined : (hits.passage(row.id) ?? row.title)),
    ),
    kindCounts: page.kindCounts,
    total: page.total,
  };
};

export const sweptIds = <R extends ListingRow>(
  index: LibraryIndex<R>,
  swept: z.infer<typeof sweptSchema>,
) => {
  const except = new Set(swept.except);

  return index
    .items({
      ...scopeFilter(swept.scope),
      kinds: swept.kinds,
      limit: Number.MAX_SAFE_INTEGER,
      offset: 0,
      order: { by: "saved" },
    })
    .items.flatMap((row) => (except.has(row.id) ? [] : [row.id]));
};

export const itemSummary = (row: ListingRow) =>
  ({
    folderId: row.folderId,
    id: row.id,
    kind: row.kind,
    pinned: row.pinnedAt !== null,
    savedAt: new Date(row.savedAt).toISOString(),
    tags: [...row.tags],
    title: row.title,
    url: row.url,
  }) satisfies z.infer<typeof itemSummarySchema>;
