// The library listing over a replica's rows: which items a grid shows, in what order and how
// many of each kind, answered from memory on the device. A page costs its own rows; only a filter
// walks the members. Pinned items lead every order; Deleted lists what was deleted and nothing
// else, and a purged item is never a row here.

import type { ItemKind } from "../items/item-kind";
import { siteMatches, urlHost } from "../items/item-url";
import { compareText } from "./block-order";

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

export interface ListingFolder {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  // its order key among its siblings
  readonly sort: string;
}

type ListingSort = "saved" | "modified" | "title" | "relevance";

export interface ListingQuery {
  // the library, or Deleted
  readonly deleted: boolean;
  readonly kinds?: readonly ItemKind[];
  // a tag and every tag under it
  readonly tag?: string;
  readonly untagged?: boolean;
  // a folder by id, or null for the items in none (Unsorted)
  readonly folderId?: string | null;
  readonly subfolders?: boolean;
  readonly site?: string;
  // saved at or after this, and before that
  readonly sinceMs?: number;
  readonly beforeMs?: number;
  // id → rank from a search (lower is better); only these answer
  readonly within?: ReadonlyMap<string, number>;
  readonly sort: ListingSort;
  readonly limit: number;
  readonly offset: number;
}

export interface ListingPage<R extends ListingRow> {
  readonly items: readonly R[];
  readonly total: number;
  // the filtered set's count per kind, the query's own kinds ignored
  readonly kindCounts: Readonly<Record<ItemKind, number>>;
}

interface FolderCount {
  readonly id: string;
  // items in it and in every folder under it
  readonly items: number;
}

export interface ListingScopes {
  readonly total: number;
  readonly unsorted: number;
  readonly untagged: number;
  // in rail order: a parent before its children, siblings by their order key, then name
  readonly folders: readonly FolderCount[];
}

interface Entry<R extends ListingRow> {
  readonly row: R;
  readonly host: string | null;
  readonly tagKeys: readonly string[];
}

type CachedSort = Exclude<ListingSort, "relevance">;

const emptyKindCounts = (): Record<ItemKind, number> => ({
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
const bySort = (a: ListingRow, b: ListingRow, sort: CachedSort): number => {
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

export class LibraryIndex<R extends ListingRow> {
  private readonly entries = new Map<string, Entry<R>>();
  private readonly sorted = new Map<string, readonly string[]>();
  private folders = new Map<string, ListingFolder>();
  private children = new Map<string | null, ListingFolder[]>();

  upsert(row: R): void {
    const prior = this.entries.get(row.id)?.row;
    this.entries.set(row.id, {
      host: row.url === null ? null : urlHost(row.url),
      row,
      tagKeys: row.tags.map((tag) => tag.toLowerCase()),
    });
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
    this.folders = new Map(folders.map((folder) => [folder.id, folder]));
    this.children = new Map();
    for (const folder of folders) {
      const parent =
        folder.parentId !== null && this.folders.has(folder.parentId) ? folder.parentId : null;
      const siblings = this.children.get(parent) ?? [];
      siblings.push(folder);
      this.children.set(parent, siblings);
    }
    for (const siblings of this.children.values()) {
      siblings.sort(
        (a, b) =>
          compareText(a.sort, b.sort) || compareText(a.name, b.name) || compareText(a.id, b.id),
      );
    }
  }

  items(query: ListingQuery): ListingPage<R> {
    const kinds = query.kinds === undefined ? null : new Set(query.kinds);
    const order =
      query.sort === "relevance" && query.within !== undefined
        ? this.relevanceOrder(query.deleted, query.within)
        : this.membersSorted(query.deleted, query.sort === "relevance" ? "saved" : query.sort);
    const folderIds = this.folderScope(query);
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
    return {
      items: matched.slice(query.offset, query.offset + query.limit),
      kindCounts,
      total: matched.length,
    };
  }

  scopes(): ListingScopes {
    const direct = new Map<string, number>();
    let total = 0;
    let unsorted = 0;
    let untagged = 0;
    for (const { row } of this.entries.values()) {
      if (row.deletedAt !== null) {
        continue;
      }
      total += 1;
      if (row.tags.length === 0) {
        untagged += 1;
      }
      const folderId = this.liveFolderOf(row);
      if (folderId === null) {
        unsorted += 1;
      } else {
        direct.set(folderId, (direct.get(folderId) ?? 0) + 1);
      }
    }
    const folders: FolderCount[] = [];
    const walk = (parent: string | null): number => {
      let sum = 0;
      for (const folder of this.children.get(parent) ?? []) {
        const at = folders.length;
        folders.push({ id: folder.id, items: 0 });
        const items = (direct.get(folder.id) ?? 0) + walk(folder.id);
        folders[at] = { id: folder.id, items };
        sum += items;
      }
      return sum;
    };
    walk(null);
    return { folders, total, unsorted, untagged };
  }

  private liveFolderOf(row: ListingRow): string | null {
    return row.folderId !== null && this.folders.has(row.folderId) ? row.folderId : null;
  }

  // the folders a query's folder answers for: it alone, or it and every folder under it
  private folderScope(query: ListingQuery): ReadonlySet<string> | null {
    if (query.folderId === undefined || query.folderId === null) {
      return null;
    }
    const scope = new Set([query.folderId]);
    if (query.subfolders === true) {
      const pending = [query.folderId];
      for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        for (const child of this.children.get(next) ?? []) {
          scope.add(child.id);
          pending.push(child.id);
        }
      }
    }
    return scope;
  }

  private passes(
    entry: Entry<R>,
    query: ListingQuery,
    folderIds: ReadonlySet<string> | null,
  ): boolean {
    const { row } = entry;
    const folderId = this.liveFolderOf(row);
    return (
      (query.deleted ? row.deletedAt !== null : row.deletedAt === null) &&
      (query.folderId !== null || folderId === null) &&
      (folderIds === null || (folderId !== null && folderIds.has(folderId))) &&
      (query.tag === undefined || inTagFamily(entry.tagKeys, query.tag)) &&
      (query.untagged !== true || row.tags.length === 0) &&
      (query.site === undefined || siteMatches(entry.host, query.site)) &&
      (query.sinceMs === undefined || row.savedAt >= query.sinceMs) &&
      (query.beforeMs === undefined || row.savedAt < query.beforeMs) &&
      (query.within === undefined || query.within.has(row.id))
    );
  }

  private dropSort(sort: CachedSort): void {
    this.sorted.delete(`live:${sort}`);
    this.sorted.delete(`deleted:${sort}`);
  }

  private membersSorted(deleted: boolean, sort: CachedSort): readonly string[] {
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

  // a search's hits in rank order, pinned first, then the saved order between equals
  private relevanceOrder(deleted: boolean, within: ReadonlyMap<string, number>): string[] {
    return [...within.keys()]
      .flatMap((id) => {
        const row = this.entries.get(id)?.row;
        return row === undefined || (row.deletedAt !== null) !== deleted ? [] : [row];
      })
      .toSorted(
        (a, b) =>
          pinRank(a) - pinRank(b) ||
          (within.get(a.id) ?? 0) - (within.get(b.id) ?? 0) ||
          b.savedAt - a.savedAt ||
          compareText(a.id, b.id),
      )
      .map((row) => row.id);
  }
}
