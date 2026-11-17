// The library listing: which items a list shows, in what order and how many of each kind, and what
// is read of it (a screen's page, the rail's counts, every title, an item as a list names it to an
// agent, the items a sweep takes). The fake cell answers it from memory here; the server answers it
// in SQL (`@repo/service/library/library-listing`), sharing the folder rail, the tags' order, a
// scope's filter and the rows each answer carries, and a suite holds the two to one order. Pinned
// items lead every order; Deleted lists what was deleted and nothing else, and a purged item is
// never a row here.

import type { z } from "zod";

import type { ItemKind } from "../items/item-kind";
import type { LibraryScope } from "../library-scope";
import type { ItemCard } from "./derive-item";
import type { LibraryItemFields } from "./library-item";
import type {
  itemSummarySchema,
  listedItemSchema,
  listingPageInputSchema,
  listingSortSchema,
  sweptSchema,
  tagCountSchema,
} from "./library-wire";
import { FolderRail } from "./folder-rail";
import type { ListingFolder } from "./folder-rail";
import { compareText } from "./order-key";

// what the listing reads of an item; a host's row type adds whatever its cards draw
export interface ListingRow {
  readonly id: string;
  readonly kind: ItemKind;
  // the card's title (`ItemCard.title`)
  readonly title: string;
  readonly folderId: string | null;
  // every tag the item carries, its field's and its body's
  readonly tags: readonly string[];
  readonly url: string | null;
  readonly savedAt: number;
  readonly updatedAt: number;
  readonly pinnedAt: number | null;
  readonly deletedAt: number | null;
}

type ListingSort = z.infer<typeof listingSortSchema>;

// id → rank from a search, lower is better
type SearchRanks = ReadonlyMap<string, number>;

export interface ListingQuery {
  // the library, or Deleted
  readonly deleted: boolean;
  readonly kinds?: readonly ItemKind[];
  // a tag and every tag under it
  readonly tag?: string;
  // a folder and every folder under it, or null for the items in none (Unsorted)
  readonly folderId?: string | null;
  readonly pinned?: boolean;
  // saved at or after this, and before that
  readonly sinceMs?: number;
  readonly beforeMs?: number;
  // by a browse's sort, or by a search's ranks, which only its hits answer, best first
  readonly order:
    | { readonly by: ListingSort }
    | { readonly by: "rank"; readonly rank: SearchRanks };
  readonly limit: number;
  readonly offset: number;
}

export interface ListingPage<R extends ListingRow> {
  readonly items: readonly R[];
  readonly total: number;
  // where the next page starts, null when this one ends the list
  readonly next: number | null;
  // the filtered set's count per kind, the query's own kinds ignored
  readonly kindCounts: Readonly<Record<ItemKind, number>>;
}

type TagCount = z.infer<typeof tagCountSchema>;

interface Entry<R extends ListingRow> {
  readonly row: R;
  readonly tagKeys: readonly string[];
}

export const emptyKindCounts = (): Record<ItemKind, number> => ({
  audio: 0,
  file: 0,
  image: 0,
  link: 0,
  note: 0,
  pdf: 0,
  video: 0,
});

const inTagFamily = (tagKeys: readonly string[], tag: string): boolean => {
  const key = tag.toLowerCase();
  return tagKeys.some((held) => held === key || held.startsWith(`${key}/`));
};

const pinRank = (row: ListingRow): number => (row.pinnedAt === null ? 1 : 0);

// each sort's order between two rows, the most recent first for the times
const bySort = (a: ListingRow, b: ListingRow, sort: ListingSort): number => {
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
    // no default
  }
};

// the rail's tags, the most held first, then by their spelling
export const compareTagCounts = (a: TagCount, b: TagCount): number =>
  b.items - a.items || a.tag.localeCompare(b.tag);

export class LibraryIndex<R extends ListingRow> {
  private readonly entries = new Map<string, Entry<R>>();
  private readonly sorted = new Map<string, readonly string[]>();
  private rail = new FolderRail([]);

  upsert(row: R): void {
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
    for (const sort of ["saved", "modified", "title"] as const) {
      if (bySort(prior, row, sort) !== 0) {
        this.dropSort(sort);
      }
    }
  }

  remove(id: string): void {
    if (this.entries.delete(id)) {
      this.sorted.clear();
    }
  }

  // the live folders; an item in a folder not named here reads as unsorted
  setFolders(folders: readonly ListingFolder[]): void {
    this.rail = new FolderRail(folders);
  }

  items(query: ListingQuery): ListingPage<R> {
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
    };
  }

  // the rail's counts, as `library.listing.scopes` answers them: the folders in rail order, each
  // with the items in it and in every folder under it; each tag under the spelling met first in
  // saved order, counting each item carrying it once however many of its spellings it holds
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

  // every live item by its card's title, as `library.listing.titles` answers them, which a note's
  // links resolve against
  titles() {
    return {
      targets: this.rowsOf(this.membersSorted(false, "title")).map(({ id, title }) => ({
        id,
        title,
      })),
    };
  }

  private rowsOf(ids: readonly string[]): R[] {
    return ids.flatMap((id) => this.entries.get(id)?.row ?? []);
  }

  private liveFolderOf(row: ListingRow): string | null {
    return row.folderId !== null && this.rail.has(row.folderId) ? row.folderId : null;
  }

  // whether a row of the query's side answers its filters, `folderIds` its folder's tree
  private passes(
    entry: Entry<R>,
    query: ListingQuery,
    folderIds: ReadonlySet<string> | null,
  ): boolean {
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

  private dropSort(sort: ListingSort): void {
    this.sorted.delete(`live:${sort}`);
    this.sorted.delete(`deleted:${sort}`);
  }

  private membersSorted(deleted: boolean, sort: ListingSort): readonly string[] {
    const cacheKey = `${deleted ? "deleted" : "live"}:${sort}`;
    const cached = this.sorted.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const order = [...this.entries.values()]
      .map(({ row }) => row)
      .filter((row) => (row.deletedAt !== null) === deleted)
      .toSorted((a, b) => pinRank(a) - pinRank(b) || bySort(a, b, sort) || compareText(a.id, b.id))
      .map((row) => row.id);
    this.sorted.set(cacheKey, order);
    return order;
  }

  // a search's hits on one side in rank order, pinned first, then the saved order between equals
  private rankOrder(deleted: boolean, ranks: SearchRanks): string[] {
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

// ---- the apps' answers ----

// a row as the apps' answers read it: the listing's facts, and the card, fields and sequence each
// answer carries
export interface ItemListing extends ListingRow {
  readonly card: ItemCard;
  readonly fields: LibraryItemFields;
  readonly seq: number;
}

// an item's row; `tags` is every tag it carries, its field's and its body's, each spelling once
export const itemListing = (
  item: {
    readonly id: string;
    readonly fields: LibraryItemFields;
    readonly card: ItemCard;
    readonly seq: number;
    readonly updatedAt: number;
  },
  tags: readonly string[],
): ItemListing => ({
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
});

// a card as an answer carries it, its outline a list of its own
export const answerCard = (card: ItemCard) => ({ ...card, outline: [...card.outline] });

type ListedItem = z.infer<typeof listedItemSchema>;

// a row as a screen's page lists it, and the passage a search found it by when one did
export const listedItem = (row: ItemListing, snippet?: string): ListedItem => {
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
  // each hit's place, best first
  readonly rank: SearchRanks;
  // the passage a hit was found by, cut for a row a page shows; null when only its title holds it
  readonly passage: (id: string) => string | null;
}

// what a scope asks the listing: every item, those in no folder, a folder and what is under it, a
// tag and its children, or what was deleted
export const scopeFilter = (
  scope: LibraryScope,
): Pick<ListingQuery, "deleted" | "folderId" | "tag"> => {
  switch (scope.kind) {
    case "all": {
      return { deleted: false };
    }
    case "unsorted": {
      return { deleted: false, folderId: null };
    }
    case "folder": {
      return { deleted: false, folderId: scope.folderId };
    }
    case "tag": {
      return { deleted: false, tag: scope.tag };
    }
    case "deleted": {
      return { deleted: true };
    }
    // no default
  }
};

// a page of a scope's listing, as `library.listing.page` answers it: its words go to `search` on
// the scope's side (Deleted, or the library), whose hits alone answer, best first, each with its
// passage; `whole` gives a row of the page as an answer carries it, so an index may hold only what
// it filters and orders by
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

// the items a sweep takes, as `library.items.sweep` names them
export const sweptIds = <R extends ListingRow>(
  index: LibraryIndex<R>,
  swept: z.infer<typeof sweptSchema>,
): string[] => {
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

// ---- an agent's answers ----

// an item as a list names it to an agent: ids and names, every tag it carries, its time ISO 8601
export const itemSummary = (row: ListingRow): z.infer<typeof itemSummarySchema> => ({
  folderId: row.folderId,
  id: row.id,
  kind: row.kind,
  pinned: row.pinnedAt !== null,
  savedAt: new Date(row.savedAt).toISOString(),
  tags: [...row.tags],
  title: row.title,
  url: row.url,
});
