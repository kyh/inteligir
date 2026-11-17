// The Library's question to the cell's listing: the scope the menu chose, the kinds the chips narrow
// it to and the words the search field holds, as one page of `listing.page`. A search ranks by the
// cell's own index, as every device's does, and Deleted searches what it lists; a scope names a
// folder by its id as the cell keeps it.

import type { LibraryScope } from "@repo/contract/library-scope";
import type { ItemKind } from "@repo/contract/items/item-kind";

// rows a page of the list holds; the next is asked for as the list nears its end
const LISTING_PAGE = 100;

export interface LibraryFilter {
  readonly scope: LibraryScope;
  readonly kinds: ReadonlySet<ItemKind>;
  // the search field's words, trimmed; "" while it is empty
  readonly words: string;
}

// the page of the listing from `cursor`, the position the last page ended at
export const listingPage = ({ kinds, scope, words }: LibraryFilter, cursor?: number) => ({
  cursor,
  kinds: kinds.size === 0 ? undefined : [...kinds],
  limit: LISTING_PAGE,
  scope,
  words: words === "" ? undefined : words,
});
