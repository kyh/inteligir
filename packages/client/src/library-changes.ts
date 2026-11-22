import { QueryObserver } from "@tanstack/query-core";
import type { QueryClient } from "@tanstack/query-core";

import { deferred } from "@repo/contract/deferred";
import type { V1Client } from "@repo/contract/rpc/v1-contract";

import { invalidateMoved } from "./library-cache";
import type { ItemsMoved, V1Queries } from "./library-cache";

const BEAT_MS = 60_000;

const REFOLLOW_MS = 2000;

export interface LibraryChanges {
  readonly start: () => () => void;
  readonly poll: () => Promise<void>;
  readonly onItems: (listener: (moved: ItemsMoved) => void) => () => void;
}

const pause = async (ms: number, stop: AbortSignal) => {
  if (stop.aborted) {
    return;
  }

  const waited = deferred();

  const stopped = () => {
    clearTimeout(timer);
    waited.resolve();
  };

  const timer = setTimeout(() => {
    stop.removeEventListener("abort", stopped);
    waited.resolve();
  }, ms);

  stop.addEventListener("abort", stopped, { once: true });
  await waited.promise;
};

interface LibraryChangesArgs {
  readonly client: V1Client;
  readonly queries: V1Queries;
  readonly queryClient: QueryClient;
}

export const createLibraryChanges = ({ client, queries, queryClient }: LibraryChangesArgs) => {
  const listeners = new Set<(moved: ItemsMoved) => void>();
  const { changes } = queries.library;
  const held = changes.queryKey({ input: {} });

  const observer = new QueryObserver(
    queryClient,
    changes.queryOptions({
      input: {},
      queryFn: async ({ signal }) => {
        const after = queryClient.getQueryData(held)?.head;
        const answer = await client.library.changes({ after }, { signal });

        if (answer.moved !== null) {
          const items = invalidateMoved(queries, queryClient, answer.moved);

          if (items === null || items.size > 0) {
            for (const listener of listeners) {
              listener(items);
            }
          }
        }

        return answer;
      },
      refetchInterval: BEAT_MS,
      refetchIntervalInBackground: false,
      refetchOnReconnect: "always",
      refetchOnWindowFocus: "always",
      retry: false,
      staleTime: BEAT_MS,
    }),
  );

  const followHeads = async (stop: AbortSignal) => {
    while (!stop.aborted) {
      try {
        const heads = await client.library.heads(undefined, { signal: stop });

        for await (const { head } of heads) {
          if (queryClient.getQueryData(held)?.head !== head) {
            await observer.refetch();
          }
        }
      } catch {
        await pause(REFOLLOW_MS, stop);
      }
    }
  };

  return {
    onItems: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    poll: async () => {
      await observer.refetch();
    },
    start: () => {
      // oxlint-disable-next-line no-empty-function -- subscribing is the ask: each answer is applied as its read lands
      const unsubscribe = observer.subscribe(() => {});
      const stop = new AbortController();

      void followHeads(stop.signal);

      return () => {
        stop.abort();
        unsubscribe();
      };
    },
  } satisfies LibraryChanges;
};
