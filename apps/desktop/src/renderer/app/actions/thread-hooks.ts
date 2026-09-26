// the timeline is not query-cached: held rows + maxSequence drive the next delta fetch.

import type { ThreadChangeKind } from "@repo/domain/change-kinds";
import type {
  GetThreadResponse,
  ListThreadsQuery,
  ListThreadsResponse,
  Thread,
  TurnChangesResponse,
} from "@repo/api/local/threads/threads-schema";
import { applyTimelineDelta } from "@repo/api/local/thread-timeline";
import type { ThreadTimeline } from "@repo/api/local/thread-timeline";
import { skipToken, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { InfiniteData, UseInfiniteQueryResult, UseQueryResult } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { client, orpc } from "../api";
import { useWorkspace } from "../workspace-context";

type ThreadListFilter = Omit<ListThreadsQuery, "cursor">;

// module-level, so the flattened list keeps its identity until a page changes.
const flattenPages = (data: InfiniteData<ListThreadsResponse, string | null>): Thread[] =>
  data.pages.flatMap((page) => page.threads);

const threadPages = (filter: ThreadListFilter | typeof skipToken) =>
  orpc.threads.list.infiniteOptions({
    getNextPageParam: (page) => page.nextCursor,
    initialPageParam: null,
    input:
      filter === skipToken
        ? skipToken
        : (cursor: string | null) => (cursor === null ? filter : { ...filter, cursor }),
    select: flattenPages,
  });

// live threads, most recently active first; `fetchNextPage` reads on past the pages held.
export const useThreads = (): UseInfiniteQueryResult<Thread[]> => useInfiniteQuery(threadPages({}));

// asked for by path, so a note's older actions are not lost below the recent pages.
export const useNoteThreads = (docPath: string | null): UseInfiniteQueryResult<Thread[]> =>
  useInfiniteQuery(threadPages(docPath === null ? skipToken : { originDocPath: docPath }));

// archived or not: an archived thread still running is still the agent at work.
const RUNNING_ANYWHERE: ListThreadsQuery = { includeArchived: true, limit: 1, running: true };

const holdsAny = (page: ListThreadsResponse): boolean => page.threads.length > 0;

export const useAgentWorking = (): boolean =>
  useQuery(orpc.threads.list.queryOptions({ input: RUNNING_ANYWHERE, select: holdsAny })).data ??
  false;

export const useThreadDetail = (threadId: string): UseQueryResult<GetThreadResponse> =>
  useQuery(orpc.threads.get.queryOptions({ input: { threadId } }));

// kept fresh by the thread's changes-committed frame, which the workspace's batch sweeps whether or
// not a transcript is open: a cached answer outlives the panel that read it.
export const useTurnChanges = (threadId: string): UseQueryResult<TurnChangesResponse> =>
  useQuery(orpc.threads.turnChanges.queryOptions({ input: { threadId } }));

// total over the kinds: one not weighed here is a row the user never sees until they reopen the thread.
const MOVES_THE_TIMELINE = {
  "archived-changed": false,
  "changes-committed": false,
  "events-appended": true,
  "interactions-changed": false,
  "origin-changed": false,
  "queue-changed": false,
  "status-changed": true,
  "thread-created": false,
  "title-changed": false,
} satisfies Record<ThreadChangeKind, boolean>;

// refused only while no rows are held: a failed delta keeps the rows on screen, and the next
// matching frame, the reconnect sweep or reopening the action retries either way.
type ThreadTimelineRead =
  | { state: "reading" }
  | { state: "read"; timeline: ThreadTimeline }
  | { state: "refused"; error: unknown };

const READING: ThreadTimelineRead = { state: "reading" };

export const useThreadTimeline = (threadId: string): ThreadTimelineRead => {
  const { threadEvents } = useWorkspace();
  const [read, setRead] = useState<ThreadTimelineRead>(READING);

  useEffect(() => {
    let disposed = false;
    let held: ThreadTimeline | null = null;
    let inFlight = false;
    let rerun = false;

    const fetchFull = async (): Promise<ThreadTimeline | null> => {
      const response = await client.threads.timeline({ threadId });
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
            const response = await client.threads.timeline({
              afterSequence: held.maxSequence,
              threadId,
            });
            next =
              response.kind === "full"
                ? response.timeline
                : (applyTimelineDelta(held, response.delta) ?? (await fetchFull()));
          }
          if (disposed) {
            break;
          }
          if (next !== null) {
            held = next;
            setRead({ state: "read", timeline: next });
          }
        } while (rerun);
      } catch (error) {
        if (!disposed && held === null) {
          setRead({ error, state: "refused" });
        }
      }
      inFlight = false;
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
  }, [threadEvents, threadId]);

  return read;
};
