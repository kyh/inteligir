// the timeline is not query-cached: held rows + maxSequence drive the next delta fetch.

import type { ThreadChangeKind } from "@repo/domain/change-kinds";
import type {
  GetThreadResponse,
  ListThreadsResponse,
} from "@repo/api/local/threads/threads-schema";
import { applyTimelineDelta, type ThreadTimeline } from "@repo/api/local/thread-timeline";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { orpc } from "../api";
import { useWorkspace } from "../workspace-context";

export function useThreads(): UseQueryResult<ListThreadsResponse> {
  return useQuery(orpc.threads.list.queryOptions());
}

export function useThreadDetail(threadId: string | null): UseQueryResult<GetThreadResponse> {
  return useQuery({
    ...orpc.threads.get.queryOptions({ input: { threadId: threadId ?? "none" } }),
    enabled: threadId !== null,
  });
}

// total over the kinds: one not weighed here is a row the user never sees until they reopen the thread.
const MOVES_THE_TIMELINE = {
  "thread-created": false,
  "events-appended": true,
  "status-changed": true,
  "archived-changed": false,
  "queue-changed": false,
  "interactions-changed": false,
  "origin-changed": false,
} satisfies Record<ThreadChangeKind, boolean>;

export function useThreadTimeline(threadId: string | null): ThreadTimeline | null {
  const { api, threadEvents } = useWorkspace();
  const [timeline, setTimeline] = useState<ThreadTimeline | null>(null);

  // drop the previous thread's rows as the id arrives, not one commit later.
  const [shownFor, setShownFor] = useState(threadId);
  if (shownFor !== threadId) {
    setShownFor(threadId);
    setTimeline(null);
  }

  useEffect(() => {
    if (threadId === null) {
      return undefined;
    }
    let disposed = false;
    let held: ThreadTimeline | null = null;
    let inFlight = false;
    let rerun = false;

    const fetchFull = async (): Promise<ThreadTimeline | null> => {
      const response = await api.threads.timeline({ threadId });
      return response.kind === "full" ? response.timeline : null;
    };

    const refresh = async (): Promise<void> => {
      if (inFlight) {
        rerun = true;
        return;
      }
      inFlight = true;
      try {
        do {
          rerun = false;
          let next: ThreadTimeline | null;
          if (held === null) {
            next = await fetchFull();
          } else {
            const response = await api.threads.timeline({
              threadId,
              afterSequence: held.maxSequence,
            });
            next =
              response.kind === "full"
                ? response.timeline
                : (applyTimelineDelta(held, response.delta) ?? (await fetchFull()));
          }
          if (disposed) {
            return;
          }
          if (next !== null) {
            held = next;
            setTimeline(next);
          }
        } while (rerun);
      } catch {
        // the next frame retries
      } finally {
        inFlight = false;
      }
    };

    void refresh();
    const unsubscribe = threadEvents.subscribe((message) => {
      if (message.id !== undefined && message.id !== threadId) {
        return;
      }
      if (message.changes.some((change) => MOVES_THE_TIMELINE[change])) {
        void refresh();
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [api, threadEvents, threadId]);

  return timeline;
}
