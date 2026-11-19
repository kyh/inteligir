import type { listedItemSchema, listingPageInputSchema } from "@repo/contract/library/library-wire";
import type { LibraryScope } from "@repo/contract/library-scope";
import type { ItemKind } from "@repo/contract/items/item-kind";
import type { z } from "zod";

import type { LibrarySort } from "../prefs";

export type ListedItem = z.infer<typeof listedItemSchema>;

export type ListingQuery = Omit<z.input<typeof listingPageInputSchema>, "cursor" | "limit">;

export interface LibraryFilter {
  readonly scope: LibraryScope;
  readonly kind: ItemKind | null;
  readonly sort: LibrarySort;
}

export const listingQuery = ({ kind, scope, sort }: LibraryFilter) =>
  (kind === null ? { scope, sort } : { kinds: [kind], scope, sort }) satisfies ListingQuery;

export const saveTagsOf = (scope: LibraryScope) =>
  (scope.kind === "tag" ? [scope.tag] : []) satisfies string[];
