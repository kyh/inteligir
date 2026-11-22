import type { z } from "zod";

import { canHoldChildren, isContainerKind } from "../items/item-kind";
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
  treeChildrenSchema,
} from "./library-wire";
import { TREE_CHILDREN_MAX } from "./library-wire";
import { listingSortSchema } from "./listing-sort";
import { compareTreeNodes, ItemTree } from "./item-tree";
import { compareText } from "./order-key";

export interface ListingRow {
  readonly id: string;
  readonly kind: ItemKind;
  readonly title: string;
  readonly parentId: string | null;
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
  readonly parentId?: string | null;
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
    folder: 0,
    image: 0,
    link: 0,
    list: 0,
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

export const treeChildrenOf = (
  rows: readonly Pick<ListingRow, "id" | "kind" | "title">[],
  parents: ReadonlySet<string>,
) => {
  const notes = rows
    .flatMap((row) =>
      row.kind === "note" ? [{ id: row.id, kind: row.kind, parentId: null, title: row.title }] : [],
    )
    .toSorted(compareTreeNodes);

  return {
    children: notes.slice(0, TREE_CHILDREN_MAX).map(({ id, kind, title }) => ({
      hasChildren: parents.has(id),
      id,
      kind,
      title,
    })),
    more: notes.length > TREE_CHILDREN_MAX,
  } satisfies z.infer<typeof treeChildrenSchema>;
};

export const compareTagCounts = (a: TagCount, b: TagCount) =>
  b.items - a.items || compareText(a.tag.toLowerCase(), b.tag.toLowerCase());

export class LibraryIndex<R extends ListingRow> {
  private readonly entries = new Map<string, Entry<R>>();
  private readonly sorted = new Map<string, readonly string[]>();
  private held: ItemTree | null = null;

  upsert(row: R) {
    const prior = this.entries.get(row.id)?.row;
    this.entries.set(row.id, { row, tagKeys: row.tags.map((tag) => tag.toLowerCase()) });

    if (
      prior === undefined ||
      prior.parentId !== row.parentId ||
      prior.title !== row.title ||
      prior.kind !== row.kind ||
      prior.deletedAt !== row.deletedAt
    ) {
      this.held = null;
    }

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
      this.held = null;
    }
  }

  tree() {
    this.held ??= new ItemTree(
      [...this.entries.values()].flatMap(({ row }) =>
        row.deletedAt === null && canHoldChildren(row.kind) ? [row] : [],
      ),
    );

    return this.held;
  }

  items(query: ListingQuery) {
    const kinds = query.kinds === undefined ? null : new Set(query.kinds);

    const order =
      query.order.by === "rank"
        ? this.rankOrder(query.deleted, query.order.rank)
        : this.membersSorted(query.deleted, query.order.by);

    const within =
      query.parentId === undefined || query.parentId === null
        ? null
        : this.tree().subtree(query.parentId);

    const kindCounts = emptyKindCounts();
    const matched: R[] = [];

    for (const id of order) {
      const entry = this.entries.get(id);

      if (entry === undefined || !this.passes(entry, query, within)) {
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
      if (isContainerKind(row.kind)) {
        continue;
      }

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

      const parentId = this.tree().liveParentOf(row.parentId, row.id);

      if (parentId === null) {
        unsorted += 1;
      } else {
        direct.set(parentId, (direct.get(parentId) ?? 0) + 1);
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
      containers: this.tree().containers(direct),
      tags: [...tags.values()].toSorted(compareTagCounts),
      total,
      unsorted,
      untagged,
    };
  }

  titles() {
    return {
      targets: this.rowsOf(this.membersSorted(false, "title")).flatMap(({ id, kind, title }) =>
        isContainerKind(kind) ? [] : [{ id, title }],
      ),
    };
  }

  private rowsOf(ids: readonly string[]) {
    return ids.flatMap((id) => this.entries.get(id)?.row ?? []);
  }

  children(parentId: string | null) {
    const tree = this.tree();

    const rows = [...this.entries.values()].flatMap(({ row }) =>
      row.deletedAt === null && tree.liveParentOf(row.parentId, row.id) === parentId ? [row] : [],
    );

    const parents = new Set(
      [...this.entries.values()].flatMap(({ row }) =>
        row.deletedAt === null && row.parentId !== null ? [row.parentId] : [],
      ),
    );

    return treeChildrenOf(rows, parents);
  }

  private passes(entry: Entry<R>, query: ListingQuery, within: ReadonlySet<string> | null) {
    const { row } = entry;
    const parentId = this.tree().liveParentOf(row.parentId, row.id);

    return (
      (query.deleted || !isContainerKind(row.kind)) &&
      (query.parentId !== null || parentId === null) &&
      (within === null || (parentId !== null && within.has(parentId))) &&
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
    parentId: item.fields.parentId,
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
      return { deleted: false } satisfies Pick<ListingQuery, "deleted" | "parentId" | "tag">;
    }

    case "unsorted": {
      return { deleted: false, parentId: null } satisfies Pick<
        ListingQuery,
        "deleted" | "parentId" | "tag"
      >;
    }

    case "parent": {
      return { deleted: false, parentId: scope.parentId } satisfies Pick<
        ListingQuery,
        "deleted" | "parentId" | "tag"
      >;
    }

    case "tag": {
      return { deleted: false, tag: scope.tag } satisfies Pick<
        ListingQuery,
        "deleted" | "parentId" | "tag"
      >;
    }

    case "deleted": {
      return { deleted: true } satisfies Pick<ListingQuery, "deleted" | "parentId" | "tag">;
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
    parentId: row.parentId,
    id: row.id,
    kind: row.kind,
    pinned: row.pinnedAt !== null,
    savedAt: new Date(row.savedAt).toISOString(),
    tags: [...row.tags],
    title: row.title,
    url: row.url,
  }) satisfies z.infer<typeof itemSummarySchema>;
