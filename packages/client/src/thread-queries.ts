// The agent's conversations as every device reads them. The threads are a query under oRPC's own
// key, read again as an answer of what moved names them (`./library-cache`); a thread's events are
// followed as they happen, from after the last one held, so a stream the cloud cut or the network
// dropped picks up where it left off, and one a device left (a screen closed, a phone locked) on
// its next read.

import { PAGE_MAX, threadEventRowSchema } from "@repo/contract/library/library-wire";
import type { threadStreamEventSchema } from "@repo/contract/library/library-wire";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { z } from "zod";

import type { V1Queries } from "./library-cache";

// how soon a stream that ended is followed again; a stream still open is never asked twice
const RECONNECT_MS = 1000;

type ThreadStreamEvent = z.infer<typeof threadStreamEventSchema>;

// what a device holds of a thread: its events in order, and the reply as written since the last
const followedThreadSchema = z.object({
  draft: z.string(),
  rows: z.array(threadEventRowSchema),
});

type FollowedThread = z.infer<typeof followedThreadSchema>;

// a draft runs from where its stream picked up to the next event, which ends it
const followedNext = (held: FollowedThread, streamed: ThreadStreamEvent): FollowedThread => {
  switch (streamed.kind) {
    case "event": {
      return { draft: "", rows: [...held.rows, streamed.row] };
    }
    case "draft": {
      return { ...held, draft: held.draft + streamed.text };
    }
    case "caughtUp": {
      return held;
    }
    // no default
  }
};

export const threadQueries = ({
  client,
  orpc,
}: {
  readonly client: V1Client;
  readonly orpc: V1Queries;
}) => ({
  threadEvents: (threadId: string) => ({
    queryFn: async ({
      client: queryClient,
      queryKey,
      signal,
    }: QueryFunctionContext): Promise<FollowedThread> => {
      const held = followedThreadSchema.safeParse(queryClient.getQueryData(queryKey));
      let thread: FollowedThread = { draft: "", rows: held.success ? held.data.rows : [] };
      const stream = await client.library.agent.events(
        { threadId },
        { lastEventId: thread.rows.at(-1)?.eventId, signal },
      );
      for await (const streamed of stream) {
        thread = followedNext(thread, streamed);
        queryClient.setQueryData(queryKey, thread);
      }
      return thread;
    },
    queryKey: orpc.library.agent.events.key({ input: { threadId } }),
    refetchInterval: RECONNECT_MS,
  }),

  // every thread of the account, newest first, since a conversation finds its title and status here
  threads: () =>
    orpc.library.agent.list.queryOptions({
      input: {},
      queryFn: async ({ signal }) => {
        const threads = [];
        let cursor: number | undefined;
        do {
          const page = await client.library.agent.list({ cursor, limit: PAGE_MAX }, { signal });
          threads.push(...page.threads);
          cursor = page.cursor ?? undefined;
        } while (cursor !== undefined);
        return { cursor: null, threads };
      },
    }),
});
