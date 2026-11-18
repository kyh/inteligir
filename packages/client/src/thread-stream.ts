// A conversation followed as it happens, every device's one way to read a thread: one query under
// the thread's events' key that streams them from after the last one held, so a stream the cloud
// cut or the network dropped picks up where it left off, and one a device left (a screen closed, a
// phone locked) on its next read; once nothing shows the thread, its stream is aborted. The reply
// as it is written is the draft since the last event. What an event moves beyond its thread is
// asked again as it lands, never as history replays: a message or a turn's end moves the thread
// among the threads and what Undo can take back, and a result or a turn's end may have changed the
// library, whose head is asked at once rather than on its beat.

import type { AgentEvent } from "@repo/contract/library/agent-events";
import { threadEventRowSchema } from "@repo/contract/library/library-wire";
import type { threadStreamEventSchema } from "@repo/contract/library/library-wire";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import type { QueryClient, QueryFunctionContext } from "@tanstack/query-core";
import { z } from "zod";

import { invalidateMoved } from "./library-cache";
import type { V1Queries } from "./library-cache";

// how soon a stream that ended is followed again while the thread shows
const RECONNECT_MS = 1000;

type ThreadStreamEvent = z.infer<typeof threadStreamEventSchema>;
type ThreadEventRow = z.infer<typeof threadEventRowSchema>;

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

const MOVES_THREAD: ReadonlySet<string> = new Set<AgentEvent["type"]>([
  "turn.ended",
  "user.message",
]);
const MOVES_LIBRARY: ReadonlySet<string> = new Set<AgentEvent["type"]>([
  "agent.tool_result",
  "turn.ended",
]);

const landed = (queryClient: QueryClient, orpc: V1Queries, row: ThreadEventRow): void => {
  if (MOVES_THREAD.has(row.type)) {
    invalidateMoved(orpc, queryClient, { folders: false, items: [], threads: [row.threadId] });
  }
  if (MOVES_LIBRARY.has(row.type)) {
    void queryClient.refetchQueries({ queryKey: orpc.library.changes.key(), type: "active" });
  }
};

export const threadStream =
  ({ client, orpc }: { readonly client: V1Client; readonly orpc: V1Queries }) =>
  (threadId: string) => ({
    queryFn: async ({
      client: queryClient,
      queryKey,
      signal,
    }: QueryFunctionContext): Promise<FollowedThread> => {
      const held = followedThreadSchema.safeParse(queryClient.getQueryData(queryKey));
      let thread: FollowedThread = { draft: "", rows: held.success ? held.data.rows : [] };
      // a resume's history is what this device missed; a first read's, what it reads fresh
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
    // never fresh, so a screen that opens it, a return to the front and a connection back each
    // follow it again at once; a stream still open is never asked twice
    staleTime: 0,
  });
