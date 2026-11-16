// A scope's listing as a device draws it, from the pages it read so far.

import type { ItemKind } from "@repo/contract/items/item-kind";
import type { listedItemSchema } from "@repo/contract/library/library-wire";
import type { z } from "zod";

// the rows the pages answered so far, and the scope's counts
export interface ListingView<R extends { readonly id: string } = z.infer<typeof listedItemSchema>> {
  readonly items: readonly R[];
  readonly total: number;
  readonly kindCounts: Readonly<Record<ItemKind, number>>;
}

// the pages laid end to end, the counts the newest page's; a row a later page answers again, as an
// offset can when the library moved between two pages, is drawn once
export const listingView = <R extends { readonly id: string }>(
  pages: readonly ListingView<R>[],
): ListingView<R> | undefined => {
  const last = pages.at(-1);
  if (last === undefined) {
    return undefined;
  }
  const seen = new Set<string>();
  const items = pages.flatMap((page) =>
    page.items.filter((row) => {
      if (seen.has(row.id)) {
        return false;
      }
      seen.add(row.id);
      return true;
    }),
  );
  return { items, kindCounts: last.kindCounts, total: last.total };
};
