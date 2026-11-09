// The grid's question to the cell's listing: the rail's scope, the kind chip, and the order the
// header chose, as one listing query. A scope names what the rail names: every item, those in no
// folder, a folder and what is under it, a tag and its children, or what was deleted. The cell
// answers it a page at a time, and the grid draws the pages read so far.

import type { listedItemSchema, listingQuerySchema } from "@repo/contract/library/library-wire";
import type { LibraryScope } from "@repo/contract/library-scope";
import type { ItemKind } from "@repo/contract/items/item-kind";
import type { ListingFolder } from "@repo/contract/library/library-index";
import type { z } from "zod";

import type { LibrarySort } from "../prefs";

// an item as the grid draws it: its row, every tag it carries and, under a search, its passage
export type ListedItem = z.infer<typeof listedItemSchema>;
export type ListingQuery = z.infer<typeof listingQuerySchema>;

export interface LibraryFilter {
  readonly scope: LibraryScope;
  readonly kind: ItemKind | null;
  readonly sort: LibrarySort;
}

const scopeQuery = (scope: LibraryScope): Partial<ListingQuery> => {
  switch (scope.kind) {
    case "all": {
      return {};
    }
    case "unsorted": {
      return { folderId: null };
    }
    case "folder": {
      return { folderId: scope.folderId, subfolders: true };
    }
    case "tag": {
      return { tag: scope.tag };
    }
    case "deleted": {
      return {};
    }
    // no default
  }
};

export const listingQuery = (filter: LibraryFilter): ListingQuery => {
  const query: ListingQuery = {
    ...scopeQuery(filter.scope),
    deleted: filter.scope.kind === "deleted",
    sort: filter.sort,
  };
  return filter.kind === null ? query : { ...query, kinds: [filter.kind] };
};

// the scope as the grid draws it: the rows its pages answered so far, and its counts
export interface ListingView<R extends { readonly id: string } = ListedItem> {
  readonly items: readonly R[];
  readonly total: number;
  readonly kindCounts: Readonly<Record<ItemKind, number>>;
}

// the pages laid end to end, the counts the newest page's; a row a later page answers again, as an
// offset can when the library moved between two pages, is drawn once
export const listingView = <R extends { readonly id: string }>(
  pages: readonly ListingView<R>[],
): ListingView<R> | undefined => {
  const last = pages.at(-1);
  if (last === undefined) {
    return undefined;
  }
  const seen = new Set<string>();
  const items = pages.flatMap((page) =>
    page.items.filter((row) => {
      if (seen.has(row.id)) {
        return false;
      }
      seen.add(row.id);
      return true;
    }),
  );
  return { items, kindCounts: last.kindCounts, total: last.total };
};

// what the header calls the scope
export const scopeTitle = (
  scope: LibraryScope,
  folders: readonly Pick<ListingFolder, "id" | "name">[],
): string => {
  switch (scope.kind) {
    case "all": {
      return "All items";
    }
    case "unsorted": {
      return "Unsorted";
    }
    case "folder": {
      return folders.find((folder) => folder.id === scope.folderId)?.name ?? "Folder";
    }
    case "tag": {
      return `#${scope.tag}`;
    }
    case "deleted": {
      return "Deleted";
    }
    // no default
  }
};

// the folder a save from this scope lands in: the shown folder's, else none (Unsorted)
export const saveFolderOf = (scope: LibraryScope): string | null =>
  scope.kind === "folder" ? scope.folderId : null;

// a tag a save from this scope carries: the shown tag's
export const saveTagsOf = (scope: LibraryScope): string[] =>
  scope.kind === "tag" ? [scope.tag] : [];
