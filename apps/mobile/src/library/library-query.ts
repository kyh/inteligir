import type { LibraryScope } from "@repo/contract/library-scope";
import type { ItemKind } from "@repo/contract/items/item-kind";

const LISTING_PAGE = 100;

export interface LibraryFilter {
  readonly scope: LibraryScope;
  readonly kinds: ReadonlySet<ItemKind>;
  readonly words: string;
}

export const listingPage = ({ kinds, scope, words }: LibraryFilter, cursor?: number) => ({
  cursor,
  kinds: kinds.size === 0 ? undefined : [...kinds],
  limit: LISTING_PAGE,
  scope,
  words: words === "" ? undefined : words,
});
