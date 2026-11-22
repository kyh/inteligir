import type { RouterUtils } from "@orpc/tanstack-query";
import type { Mutation, QueryClient } from "@tanstack/query-core";
import type { z } from "zod";

import type { libraryMovedSchema } from "@repo/contract/library/library-wire";
import { sharedFailure } from "@repo/contract/rpc/call-outcome";
import type { V1Client } from "@repo/contract/rpc/v1-contract";

export type V1Queries = RouterUtils<V1Client>;

export type ItemsMoved = ReadonlySet<string> | null;

type LibraryMoved = z.infer<typeof libraryMovedSchema>;

const QUERY_TRIES = 3;

export const LIBRARY_WRITES = { id: "library" };

export const inLibraryQueue = (mutation: Mutation<unknown, unknown>) =>
  mutation.options.scope?.id === LIBRARY_WRITES.id;

const onceQueueEmpty = (queryClient: QueryClient, read: () => void) => {
  const waits = () => queryClient.isMutating({ predicate: inLibraryQueue }) > 0;

  if (!waits()) {
    read();

    return;
  }

  const stop = queryClient.getMutationCache().subscribe(() => {
    if (!waits()) {
      stop();
      read();
    }
  });
};

export const retryUnlessRefused = (failures: number, cause: Error) => {
  const kind = sharedFailure(cause)?.kind;

  return failures < QUERY_TRIES && (kind === "unreachable" || kind === "busy");
};

export const invalidateMoved = (
  { library }: V1Queries,
  queryClient: QueryClient,
  moved: LibraryMoved,
) => {
  let items: ItemsMoved = new Set();

  if (moved.items === "all") {
    items = null;
    void queryClient.invalidateQueries({ queryKey: library.items.get.key() });
    onceQueueEmpty(queryClient, () => {
      void queryClient.invalidateQueries({ queryKey: library.items.row.key() });
      void queryClient.invalidateQueries({ queryKey: library.listing.key() });
    });
  } else if (moved.items.length > 0) {
    const named = moved.items;
    items = new Set(named.map(({ id }) => id));

    for (const { id, seq } of named) {
      const whole = library.items.get.queryKey({ input: { id } });

      if ((queryClient.getQueryData(whole)?.seq ?? -1) < seq) {
        void queryClient.invalidateQueries({ exact: true, queryKey: whole });
      }
    }

    onceQueueEmpty(queryClient, () => {
      for (const { id, seq } of named) {
        const row = library.items.row.queryKey({ input: { id } });

        if ((queryClient.getQueryData(row)?.seq ?? -1) < seq) {
          void queryClient.invalidateQueries({ exact: true, queryKey: row });
        }
      }

      void queryClient.invalidateQueries({ queryKey: library.listing.key() });
    });
  }

  if (moved.tree) {
    onceQueueEmpty(queryClient, () => {
      void queryClient.invalidateQueries({ queryKey: library.listing.scopes.key() });
      void queryClient.invalidateQueries({ queryKey: library.listing.children.key() });
    });
  }

  if (moved.threads === "all" || moved.threads.length > 0) {
    void queryClient.invalidateQueries({ queryKey: library.agent.list.key() });
    void queryClient.invalidateQueries({ queryKey: library.agent.undoable.key() });
  }

  return items;
};
