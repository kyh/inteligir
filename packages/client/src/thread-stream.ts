import type { AgentEvent } from "@repo/contract/library/agent-events";
import { threadEventRowSchema } from "@repo/contract/library/library-wire";
import type { threadStreamEventSchema } from "@repo/contract/library/library-wire";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import type { QueryClient, QueryFunctionContext } from "@tanstack/query-core";
import { z } from "zod";

import { invalidateMoved } from "./library-cache";
import type { V1Queries } from "./library-cache";

const RECONNECT_MS = 1000;

type ThreadStreamEvent = z.infer<typeof threadStreamEventSchema>;

type ThreadEventRow = z.infer<typeof threadEventRowSchema>;

const followedThreadSchema = z.object({
  draft: z.string(),
  rows: z.array(threadEventRowSchema),
});

type FollowedThread = z.infer<typeof followedThreadSchema>;

const followedNext = (held: FollowedThread, streamed: ThreadStreamEvent) => {
  switch (streamed.kind) {
    case "event": {
      return { draft: "", rows: [...held.rows, streamed.row] } satisfies FollowedThread;
    }

    case "draft": {
      return { ...held, draft: held.draft + streamed.text } satisfies FollowedThread;
    }

    case "caughtUp": {
      return held;
    }

    default: {
      throw new Error(`unexpected ${String(streamed satisfies never)}`);
    }
  }
};

const MOVES_THREAD: ReadonlySet<string> = new Set<AgentEvent["type"]>([
  "turn.ended",
  "user.message",
]);

const MOVES_LIBRARY: ReadonlySet<string> = new Set<AgentEvent["type"]>([
  "agent.tool_result",
  "turn.ended",
]);

const landed = (queryClient: QueryClient, orpc: V1Queries, row: ThreadEventRow) => {
  if (MOVES_THREAD.has(row.type)) {
    invalidateMoved(orpc, queryClient, { items: [], threads: [row.threadId], tree: false });
  }

  if (MOVES_LIBRARY.has(row.type)) {
    void queryClient.refetchQueries({ queryKey: orpc.library.changes.key(), type: "active" });
  }
};

export const threadStream =
  ({ client, orpc }: { readonly client: V1Client; readonly orpc: V1Queries }) =>
  (threadId: string) => ({
    queryFn: async ({ client: queryClient, queryKey, signal }: QueryFunctionContext) => {
      const held = followedThreadSchema.safeParse(queryClient.getQueryData(queryKey));
      let thread: FollowedThread = { draft: "", rows: held.success ? held.data.rows : [] };
      let live = thread.rows.length > 0;

      const stream = await client.library.agent.events(
        { threadId },
        { lastEventId: thread.rows.at(-1)?.eventId, signal },
      );

      for await (const streamed of stream) {
        thread = followedNext(thread, streamed);
        queryClient.setQueryData(queryKey, thread);

        if (streamed.kind === "caughtUp") {
          live = true;
        } else if (streamed.kind === "event" && live) {
          landed(queryClient, orpc, streamed.row);
        }
      }

      return thread;
    },
    queryKey: orpc.library.agent.events.key({ input: { threadId } }),
    refetchInterval: RECONNECT_MS,
    staleTime: 0,
  });
