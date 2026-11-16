// The grid's question to the cell's listing: the rail's scope, the kind chip, and the order the
// header chose, as one listing query. A scope names what the rail names: every item, those in no
// folder, a folder and what is under it, a tag and its children, or what was deleted. The cell
// answers it a page at a time, and the grid draws the pages read so far
// (`@repo/client/listing-view`).

import { scopeQuery } from "@repo/client/library-labels";
import type { listedItemSchema, listingQuerySchema } from "@repo/contract/library/library-wire";
import type { LibraryScope } from "@repo/contract/library-scope";
import type { ItemKind } from "@repo/contract/items/item-kind";
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

export const listingQuery = (filter: LibraryFilter): ListingQuery => {
  const query: ListingQuery = { ...scopeQuery(filter.scope), sort: filter.sort };
  return filter.kind === null ? query : { ...query, kinds: [filter.kind] };
};

// a tag a save from this scope carries: the shown tag's
export const saveTagsOf = (scope: LibraryScope): string[] =>
  scope.kind === "tag" ? [scope.tag] : [];
