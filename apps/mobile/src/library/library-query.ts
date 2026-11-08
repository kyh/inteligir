// The Library's question to the cell's listing: the scope the menu chose, the kinds the chips narrow
// it to and the words the search field holds, as one page of `listing.page`. A search ranks by the
// cell's own index, as every device's does, and Deleted searches what it lists; a scope names a
// folder by its id as the cell keeps it.

import type { z } from "zod";
import type { LibraryScope } from "@repo/domain/library-scope";
import type { listingQuerySchema } from "@repo/contract/cloud/library/library-wire";
import type { ItemKind } from "@repo/notes/items/item-kind";

type ListingQuery = z.infer<typeof listingQuerySchema>;

// rows a page of the list holds; the next is asked for as the list nears its end
const LISTING_PAGE = 100;

export interface LibraryFilter {
  readonly scope: LibraryScope;
  readonly kinds: ReadonlySet<ItemKind>;
  // the search field's words, trimmed; "" while it is empty
  readonly words: string;
}

/** @internal */
export const listingQuery = ({ kinds, scope, words }: LibraryFilter): ListingQuery => {
  const query: ListingQuery = {
    deleted: scope.kind === "deleted",
    kinds: kinds.size === 0 ? undefined : [...kinds],
    sort: words === "" ? "saved" : "relevance",
  };
  switch (scope.kind) {
    case "all":
    case "deleted": {
      return query;
    }
    case "unsorted": {
      return { ...query, folderId: null };
    }
    case "folder": {
      return { ...query, folderId: scope.folderId, subfolders: true };
    }
    case "tag": {
      return { ...query, tag: scope.tag };
    }
    // no default
  }
};

// the page of the listing from `cursor`, the position the last page ended at
export const listingPage = (filter: LibraryFilter, cursor?: number) => ({
  cursor,
  limit: LISTING_PAGE,
  query: listingQuery(filter),
  words: filter.words === "" ? undefined : filter.words,
});

// what the header calls the scope
export const scopeTitle = (
  scope: LibraryScope,
  folders: readonly { readonly id: string; readonly name: string }[],
): string => {
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
