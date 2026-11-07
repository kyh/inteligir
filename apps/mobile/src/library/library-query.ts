// The Library's question to the replica's listing: the scope the menu chose, the kinds the chips
// narrow it to and the words the search field holds, as one `ListingQuery`. A search ranks by the
// replica's own full-text index, offline as every device ranks it, and Deleted searches what it
// lists; a scope names a folder by its id as the cell keeps it.

import type { LibraryScope } from "@repo/domain/library-scope";
import type { LibraryReplica } from "@repo/library-replica/library-replica";
import type { ItemKind } from "@repo/notes/items/item-kind";
import type { ListingFolder, ListingQuery } from "@repo/notes/library/library-index";
import type { SearchSide } from "@repo/notes/library/library-queries";

// at most this many hits a search ranks
const SEARCH_HITS = 500;

export interface LibraryFilter {
  readonly scope: LibraryScope;
  readonly kinds: ReadonlySet<ItemKind>;
  // a search's hits by item id, best first; null while the field is empty
  readonly hits: ReadonlyMap<string, number> | null;
}

export const searchSideOf = (scope: LibraryScope): SearchSide =>
  scope.kind === "deleted" ? "deleted" : "live";

// the words' hits by item id, best first
export const searchHits = async (
  replica: Pick<LibraryReplica, "search">,
  words: string,
  side: SearchSide,
): Promise<ReadonlyMap<string, number>> => {
  const found = await replica.search(words, SEARCH_HITS, side);
  return new Map(found.map((hit, rank) => [hit.itemId, rank]));
};

export const listingQuery = ({ hits, kinds, scope }: LibraryFilter): ListingQuery => {
  const query: ListingQuery = {
    deleted: scope.kind === "deleted",
    // every row: the listing is in memory, and a row is drawn only where it is in view
    limit: Number.POSITIVE_INFINITY,
    offset: 0,
    sort: hits === null ? "saved" : "relevance",
  };
  const narrowed: ListingQuery = kinds.size === 0 ? query : { ...query, kinds: [...kinds] };
  const searched: ListingQuery = hits === null ? narrowed : { ...narrowed, within: hits };
  switch (scope.kind) {
    case "all":
    case "deleted": {
      return searched;
    }
    case "unsorted": {
      return { ...searched, folderId: null };
    }
    case "folder": {
      return { ...searched, folderId: scope.folderId, subfolders: true };
    }
    case "tag": {
      return { ...searched, tag: scope.tag };
    }
    // no default
  }
};

// what the header calls the scope
export const scopeTitle = (scope: LibraryScope, folders: readonly ListingFolder[]): string => {
  switch (scope.kind) {
    case "all": {
      return "Library";
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

// a scope's new note and saved link land in its folder; every other scope's in Unsorted
export const saveFolderOf = (scope: LibraryScope): string | null =>
  scope.kind === "folder" ? scope.folderId : null;
