import { threadQueries } from "@repo/client/thread-queries";
import { keepPreviousData, skipToken } from "@tanstack/react-query";

import type { listedItemSchema, listingPageInputSchema } from "@repo/contract/library/library-wire";
import type { z } from "zod";

import type { CloudWire } from "./v1";

export type ListedItem = z.infer<typeof listedItemSchema>;

export type ListingQuery = Omit<z.input<typeof listingPageInputSchema>, "cursor" | "limit">;

const LISTING_PAGE = 200;
const SEARCH_LIMIT = 20;

export const libraryQueries = ({ client, orpc }: CloudWire) => ({
  ...threadQueries({ client, orpc }),

  children: (parentId: string | null) =>
    orpc.library.listing.children.queryOptions({ input: { parentId } }),

  item: (id: string) => orpc.library.items.row.queryOptions({ input: { id } }),

  listing: (query: ListingQuery) =>
    orpc.library.listing.page.infiniteOptions({
      getNextPageParam: (last) => last.cursor,
      initialPageParam: undefined,
      input: (cursor: number | undefined) => ({ ...query, cursor, limit: LISTING_PAGE }),
      placeholderData: keepPreviousData,
    }),

  scopes: () => orpc.library.listing.scopes.queryOptions(),

  search: (words: string) =>
    orpc.library.listing.page.queryOptions({
      input: words === "" ? skipToken : { limit: SEARCH_LIMIT, scope: { kind: "all" }, words },
      placeholderData: keepPreviousData,
    }),

  titles: () => orpc.library.listing.titles.queryOptions(),

  undoable: (threadId: string) => orpc.library.agent.undoable.queryOptions({ input: { threadId } }),
});
