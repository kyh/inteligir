// What a device shows of the account's library: every read is a TanStack query under oRPC's key, so
// an answer of what moved (`./library-changes`) marks stale the queries over what it names. An
// item's read goes again only when the copy held is older than the sequence the answer names, so a
// note's typing reads its row again only when it changed what a row holds. A thread's events follow
// it as it happens (`./thread-stream`), so nothing here reads them again. A write a device lays over
// its listings and rows before it lands waits in the library's queue, and an answer reads those
// again only once the queue is empty, since a read while one waits takes it off the screen.

import type { RouterUtils } from "@orpc/tanstack-query";
import type { Mutation, QueryClient } from "@tanstack/query-core";
import type { z } from "zod";

import type { libraryMovedSchema } from "@repo/contract/library/library-wire";
import { sharedFailure } from "@repo/contract/rpc/call-outcome";
import type { V1Client } from "@repo/contract/rpc/v1-contract";

export type V1Queries = RouterUtils<V1Client>;

// the items a write moved, or null when any may have
export type ItemsMoved = ReadonlySet<string> | null;

type LibraryMoved = z.infer<typeof libraryMovedSchema>;

const QUERY_TRIES = 3;

// the one queue a device's writes to the library's items and folders wait in, so they land in the
// order they were asked
export const LIBRARY_WRITES = { id: "library" };

export const inLibraryQueue = (mutation: Mutation<unknown, unknown>): boolean =>
  mutation.options.scope?.id === LIBRARY_WRITES.id;

// `read` now, or once no write waits in the library's queue; a write is counted until it has read
// again what it settled, so an answer that came meanwhile is read after that read
const onceQueueEmpty = (queryClient: QueryClient, read: () => void): void => {
  const waits = (): boolean => queryClient.isMutating({ predicate: inLibraryQueue }) > 0;
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

// a call the cloud did not answer, or answered busy, is asked again; a refusal never is, since it
// answers the same however often it is asked
export const retryUnlessRefused = (failures: number, cause: Error): boolean => {
  const kind = sharedFailure(cause)?.kind;
  return failures < QUERY_TRIES && (kind === "unreachable" || kind === "busy");
};

// every read what moved names, and the items it moved; what a write in the library's queue is laid
// over, every listing and an item's row, once the queue is empty
export const invalidateMoved = (
  { library }: V1Queries,
  queryClient: QueryClient,
  moved: LibraryMoved,
): ItemsMoved => {
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
  if (moved.folders) {
    onceQueueEmpty(queryClient, () => {
      void queryClient.invalidateQueries({ queryKey: library.listing.scopes.key() });
    });
  }
  if (moved.threads === "all" || moved.threads.length > 0) {
    void queryClient.invalidateQueries({ queryKey: library.agent.list.key() });
    void queryClient.invalidateQueries({ queryKey: library.agent.undoable.key() });
  }
  return items;
};
