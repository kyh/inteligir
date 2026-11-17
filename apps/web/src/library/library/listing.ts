// The grid's question to the cell's listing: the rail's scope, the kind chip, and the order the
// header chose, as what a page of `listing.page` asks. The cell answers it a page at a time, and
// the grid draws the pages read so far (`@repo/client/listing-view`).

import type { listedItemSchema, listingPageInputSchema } from "@repo/contract/library/library-wire";
import type { LibraryScope } from "@repo/contract/library-scope";
import type { ItemKind } from "@repo/contract/items/item-kind";
import type { z } from "zod";

import type { LibrarySort } from "../prefs";

// an item as the grid draws it: its row, every tag it carries and, under a search, its passage
export type ListedItem = z.infer<typeof listedItemSchema>;
// what every page of one listing asks, its own place aside
export type ListingQuery = Omit<z.input<typeof listingPageInputSchema>, "cursor" | "limit">;

export interface LibraryFilter {
  readonly scope: LibraryScope;
  readonly kind: ItemKind | null;
  readonly sort: LibrarySort;
}

export const listingQuery = ({ kind, scope, sort }: LibraryFilter): ListingQuery =>
  kind === null ? { scope, sort } : { kinds: [kind], scope, sort };

// a tag a save from this scope carries: the shown tag's
export const saveTagsOf = (scope: LibraryScope): string[] =>
  scope.kind === "tag" ? [scope.tag] : [];
