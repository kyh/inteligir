// The grid's question to the replica's listing: the rail's scope, the kind chip, and the order the
// header chose, as one `ListingQuery`. A scope names what the rail names: every item, those in no
// folder, a folder and what is under it, a tag and its children, or what was deleted.

import type { LibraryScope } from "@repo/domain/library-scope";
import type { ItemKind } from "@repo/notes/items/item-kind";
import type { ListingFolder, ListingQuery } from "@repo/notes/library/library-index";

import type { LibrarySort } from "../prefs";

// the rows one listing read answers: the grid asks for its whole count, since the listing is in
// memory and a card is drawn only where it is in view
const LISTING_PAGE_MAX = 100_000;

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
    limit: LISTING_PAGE_MAX,
    offset: 0,
    sort: filter.sort,
  };
  return filter.kind === null ? query : { ...query, kinds: [filter.kind] };
};

// a stored folder scope the library no longer lists reads as every item
export const listedScope = (
  scope: LibraryScope,
  folders: readonly ListingFolder[],
): LibraryScope =>
  scope.kind === "folder" && !folders.some((folder) => folder.id === scope.folderId)
    ? { kind: "all" }
    : scope;

// what the header calls the scope
export const scopeTitle = (scope: LibraryScope, folders: readonly ListingFolder[]): string => {
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
