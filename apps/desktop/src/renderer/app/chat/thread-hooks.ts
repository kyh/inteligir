// Thread state for the workspace. List/detail are query-cached and
// swept whole by the ws thread invalidation; the TIMELINE is deliberately
// not — it is stateful (held rows + maxSequence drive the next delta fetch),
// so its hook holds it and refreshes off threadEvents directly.

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

/**
 * Which change kinds can have moved the TIMELINE, and therefore earn a delta
 * fetch. A total table rather than the two-member `||` it replaces: the
 * timeline is the one thread surface the ws sweep does not cover (it is not
 * query-cached), so a kind that arrives and is not weighed here is a row the
 * user never sees until they reopen the thread. "false" is the answer for a
 * kind whose whole effect is on the LIST — the query sweep beside this
 * subscriber already refetches that.
 */
const MOVES_THE_TIMELINE = {
  "thread-created": false,
  "events-appended": true,
  "status-changed": true,
  "archived-changed": false,
  "queue-changed": false,
  "interactions-changed": false,
  "origin-changed": false,
} satisfies Record<ThreadChangeKind, boolean>;

/**
 * The live timeline: full fetch on mount, then a delta fetch per
 * events/status frame, applied over the held rows; a delta whose base is not
 * the held timeline falls back to one full refetch. Refreshes are serialized
 * with a re-run flag so overlapping frames coalesce instead of racing.
 */
export function useThreadTimeline(threadId: string | null): ThreadTimeline | null {
  const { api, threadEvents } = useWorkspace();
  const [timeline, setTimeline] = useState<ThreadTimeline | null>(null);

  useEffect(() => {
    setTimeline(null);
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
        // Transient fetch failure: the next frame (or reconnect sweep) retries.
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
