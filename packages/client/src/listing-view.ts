import type { ItemKind } from "@repo/contract/items/item-kind";
import type { listedItemSchema } from "@repo/contract/library/library-wire";
import type { z } from "zod";

export interface ListingView<R extends { readonly id: string } = z.infer<typeof listedItemSchema>> {
  readonly items: readonly R[];
  readonly total: number;
  readonly kindCounts: Readonly<Record<ItemKind, number>>;
}

export const listingView = <R extends { readonly id: string }>(
  pages: readonly ListingView<R>[],
) => {
  const last = pages.at(-1);

  if (last === undefined) {
    return;
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

  return { items, kindCounts: last.kindCounts, total: last.total } satisfies
    | ListingView<R>
    | undefined;
};
