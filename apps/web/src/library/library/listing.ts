import type { LibraryScope } from "@repo/contract/library-scope";
import type { ItemKind } from "@repo/contract/items/item-kind";

import type { ListingQuery } from "../cloud/library-queries";
import type { LibrarySort } from "../prefs";

export interface LibraryFilter {
  readonly scope: LibraryScope;
  readonly kind: ItemKind | null;
  readonly sort: LibrarySort;
}

export const listingQuery = ({ kind, scope, sort }: LibraryFilter) =>
  (kind === null ? { scope, sort } : { kinds: [kind], scope, sort }) satisfies ListingQuery;

export const saveTagsOf = (scope: LibraryScope) =>
  (scope.kind === "tag" ? [scope.tag] : []) satisfies string[];
