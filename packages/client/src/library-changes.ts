// How a device learns what moved in the library: it asks `library.changes` for what moved after the
// head it holds, every 15 s while it is in front and at once on focus and on reconnect, and each
// answer marks stale the reads over what it names (`./library-cache`). One small read and a few
// targeted refetches cost less than reading every screen again, and an open note learns its item
// moved. The first ask learns the head alone, since what a device reads after it is fresh. Its
// beat, focus and reconnect are TanStack's own, from the host's focus and online managers.

import { QueryObserver } from "@tanstack/query-core";
import type { QueryClient } from "@tanstack/query-core";

import type { V1Client } from "@repo/contract/rpc/v1-contract";

import { invalidateMoved } from "./library-cache";
import type { ItemsMoved, V1Queries } from "./library-cache";

const BEAT_MS = 15_000;

export interface LibraryChanges {
  // asks on its beat from now, until the stop it answers
  readonly start: () => () => void;
  // asks now, settled once the answer is applied or failed
  readonly poll: () => Promise<void>;
  // the items each answer names, or null when any may have moved
  readonly onItems: (listener: (moved: ItemsMoved) => void) => () => void;
}

interface LibraryChangesArgs {
  readonly client: V1Client;
  readonly queries: V1Queries;
  readonly queryClient: QueryClient;
}

export const createLibraryChanges = ({
  client,
  queries,
  queryClient,
}: LibraryChangesArgs): LibraryChanges => {
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
      // an ask that failed waits for the next beat, focus or reconnect
      retry: false,
      staleTime: BEAT_MS,
    }),
  );
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
    start: () =>
      observer.subscribe(() => {
        // subscribed is asking: each answer is applied as its read lands
      }),
  };
};
