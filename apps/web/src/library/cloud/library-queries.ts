// The library's reads as the cell answers them, each a TanStack query under oRPC's own key, so the
// account's socket invalidates a family by its key (`@repo/client/library-cache`) and a mutation
// patches what a screen shows by the same keys.

import { threadQueries } from "@repo/client/thread-queries";
import { keepPreviousData, skipToken } from "@tanstack/react-query";

import type { ListingQuery } from "../library/listing";
import type { CloudWire } from "./v1";

// a grid's page: past it the grid asks for the next as it scrolls near the end
const LISTING_PAGE = 200;
// ⌘P's hits
const SEARCH_LIMIT = 20;

export const libraryQueries = ({ client, orpc }: CloudWire) => ({
  // the agent's threads and a thread's events, as every device reads them
  ...threadQueries({ client, orpc }),

  // an item's row, its fields and card: its body is its note's, which the editor reads live
  item: (id: string) => orpc.library.items.row.queryOptions({ input: { id } }),

  // the scope a page at a time from the cell's own position; a new scope keeps the grid it leaves
  // on screen until its first page answers
  listing: (query: ListingQuery) =>
    orpc.library.listing.page.infiniteOptions({
      getNextPageParam: (last) => last.cursor,
      initialPageParam: undefined,
      input: (cursor: number | undefined) => ({ ...query, cursor, limit: LISTING_PAGE }),
      placeholderData: keepPreviousData,
    }),

  scopes: () => orpc.library.listing.scopes.queryOptions(),

  // CLAUDE.md § There is one search surface, and it is ⌘P. The library's side only, ranked by the
  // cell; the hits typed before stay up while the next words are asked
  search: (words: string) =>
    orpc.library.listing.page.queryOptions({
      input: words === "" ? skipToken : { limit: SEARCH_LIMIT, scope: { kind: "all" }, words },
      placeholderData: keepPreviousData,
    }),

  titles: () => orpc.library.listing.titles.queryOptions(),

  // the conversation's turns that still hold something to take back, which each finished turn's
  // Undo and the whole conversation's show by; the socket asks again as a turn or an undo moves
  // the thread
  undoable: (threadId: string) => orpc.library.agent.undoable.queryOptions({ input: { threadId } }),
});

export type LibraryQueries = ReturnType<typeof libraryQueries>;
