import type { LibraryScope } from "@repo/contract/library-scope";
import type { ItemKind } from "@repo/contract/items/item-kind";

import type { ListingQuery } from "../cloud/library-queries";
import type { LibrarySort } from "../prefs";

export interface LibraryFilter {
  readonly scope: LibraryScope;
  readonly kind: ItemKind | null;
  readonly sort: LibrarySort;
  readonly words: string | null;
}

export const listingQuery = ({ kind, scope, sort, words }: LibraryFilter) => {
  const query: ListingQuery = { scope, sort };

  if (kind !== null) {
    query.kinds = [kind];
  }

  if (words !== null) {
    query.words = words;
  }

  return query;
};

export const saveTagsOf = (scope: LibraryScope) =>
  (scope.kind === "tag" ? [scope.tag] : []) satisfies string[];
