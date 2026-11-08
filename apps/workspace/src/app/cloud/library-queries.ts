// The library's reads as the cell answers them, each a TanStack query under oRPC's own key, so the
// account's socket invalidates a family by its key (`use-library-socket.ts`) and a mutation patches
// what a screen shows by the same keys.

import type { InferClientOutputs } from "@orpc/client";
import { PAGE_MAX } from "@repo/contract/cloud/library/library-wire";
import type { V1Client } from "@repo/contract/cloud/v1";
import { keepPreviousData, queryOptions, skipToken } from "@tanstack/react-query";

import type { ListingQuery } from "../library/listing";
import type { CloudWire } from "./v1";

type Outputs = InferClientOutputs<V1Client>["library"];

// a grid's page: past it the grid asks for the next as it scrolls near the end
const LISTING_PAGE = 200;
// ⌘P's hits
const SEARCH_LIMIT = 20;
const EVENTS_PAGE = 500;

export const libraryQueries = ({ client, orpc }: CloudWire) => ({
  item: (id: string) => orpc.library.items.get.queryOptions({ input: { id } }),

  // the scope a page at a time from the cell's own position; a new scope keeps the grid it leaves
  // on screen until its first page answers
  listing: (query: ListingQuery) =>
    orpc.library.listing.page.infiniteOptions({
      getNextPageParam: (last) => last.nextCursor,
      initialPageParam: undefined,
      input: (cursor: number | undefined) => ({ cursor, limit: LISTING_PAGE, query }),
      placeholderData: keepPreviousData,
    }),

  scopes: () => orpc.library.listing.scopes.queryOptions(),

  // CLAUDE.md § THERE IS ONE SEARCH SURFACE, AND IT IS ⌘P. The library's side only, ranked by the
  // cell; the hits typed before stay up while the next words are asked
  search: (words: string) =>
    orpc.library.listing.page.queryOptions({
      input:
        words === ""
          ? skipToken
          : { limit: SEARCH_LIMIT, query: { deleted: false, sort: "relevance" }, words },
      placeholderData: keepPreviousData,
    }),

  titles: () => orpc.library.listing.titles.queryOptions(),

  // a thread's stored events in order: a thread only grows, so a refetch asks only for what came
  // after the last one held
  threadEvents: (threadId: string) =>
    queryOptions({
      ...orpc.library.agent.events.queryOptions({ input: { threadId } }),
      queryFn: async ({ client: queryClient, queryKey, signal }) => {
        const events = [...(queryClient.getQueryData(queryKey)?.events ?? [])];
        for (;;) {
          const page = await client.library.agent.events(
            { after: events.at(-1)?.idx, limit: EVENTS_PAGE, threadId },
            { signal },
          );
          events.push(...page.events);
          if (!page.more || page.events.length === 0) {
            return { events, more: false };
          }
        }
      },
    }),

  // every thread of the account, newest first
  threads: () =>
    queryOptions({
      ...orpc.library.agent.list.queryOptions({ input: {} }),
      queryFn: async ({ signal }): Promise<Outputs["agent"]["list"]> => {
        const threads = [];
        let cursor: string | undefined;
        do {
          const page = await client.library.agent.list({ cursor, limit: PAGE_MAX }, { signal });
          threads.push(...page.threads);
          cursor = page.cursor ?? undefined;
        } while (cursor !== undefined);
        return { cursor: null, threads };
      },
    }),
});

export type LibraryQueries = ReturnType<typeof libraryQueries>;
