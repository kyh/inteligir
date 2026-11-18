import { QueryObserver } from "@tanstack/query-core";
import type { QueryClient } from "@tanstack/query-core";

import type { V1Client } from "@repo/contract/rpc/v1-contract";

import { invalidateMoved } from "./library-cache";
import type { ItemsMoved, V1Queries } from "./library-cache";

const BEAT_MS = 15_000;

export interface LibraryChanges {
  readonly start: () => () => void;
  readonly poll: () => Promise<void>;
  readonly onItems: (listener: (moved: ItemsMoved) => void) => () => void;
}

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
    // oxlint-disable-next-line no-empty-function -- subscribing is the ask: each answer is applied as its read lands
    start: () => observer.subscribe(() => {}),
  } satisfies LibraryChanges;
};
