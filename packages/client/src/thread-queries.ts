// The agent's conversations as every device reads them, under oRPC's own keys, so the account's
// socket reads them again by the keys it invalidates (`./library-cache`).

import { PAGE_MAX } from "@repo/contract/library/library-wire";
import type { V1Client } from "@repo/contract/v1";

import type { V1Queries } from "./library-cache";

const EVENTS_PAGE = 500;

export const threadQueries = ({
  client,
  orpc,
}: {
  readonly client: V1Client;
  readonly orpc: V1Queries;
}) => ({
  // a thread's stored events in order: a thread only grows, so a refetch asks only for what came
  // after the last one held
  threadEvents: (threadId: string) => {
    const held = orpc.library.agent.events.queryKey({ input: { threadId } });
    return orpc.library.agent.events.queryOptions({
      input: { threadId },
      queryFn: async ({ client: queryClient, signal }) => {
        const events = [...(queryClient.getQueryData(held)?.events ?? [])];
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
    });
  },

  // every thread of the account, newest first, since a conversation finds its title and status here
  threads: () =>
    orpc.library.agent.list.queryOptions({
      input: {},
      queryFn: async ({ signal }) => {
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
