// What a device shows of the account's library: every read is a TanStack query under oRPC's key, so
// an answer of what moved (`./library-changes`) marks stale the queries over what it names. An
// item's read goes again only when the copy held is older than the sequence the answer names, so a
// note's typing reads its row again only when it changed what a row holds.

import type { RouterUtils } from "@orpc/tanstack-query";
import type { QueryClient } from "@tanstack/query-core";
import type { z } from "zod";

import type { libraryMovedSchema } from "@repo/contract/library/library-wire";
import { sharedFailure } from "@repo/contract/rpc/call-outcome";
import type { V1Client } from "@repo/contract/rpc/v1-contract";

export type V1Queries = RouterUtils<V1Client>;

// the items a write moved, or null when any may have
export type ItemsMoved = ReadonlySet<string> | null;

type LibraryMoved = z.infer<typeof libraryMovedSchema>;

const QUERY_TRIES = 3;

// a call the cloud did not answer, or answered busy, is asked again; a refusal never is, since it
// answers the same however often it is asked
export const retryUnlessRefused = (failures: number, cause: Error): boolean => {
  const kind = sharedFailure(cause)?.kind;
  return failures < QUERY_TRIES && (kind === "unreachable" || kind === "busy");
};

// every read what moved names, and the items it moved
export const invalidateMoved = (
  { library }: V1Queries,
  queryClient: QueryClient,
  moved: LibraryMoved,
): ItemsMoved => {
  let items: ItemsMoved = new Set();
  if (moved.items === "all") {
    items = null;
    void queryClient.invalidateQueries({ queryKey: library.items.row.key() });
    void queryClient.invalidateQueries({ queryKey: library.items.get.key() });
    void queryClient.invalidateQueries({ queryKey: library.listing.key() });
  } else if (moved.items.length > 0) {
    items = new Set(moved.items.map(({ id }) => id));
    for (const { id, seq } of moved.items) {
      const row = library.items.row.queryKey({ input: { id } });
      if ((queryClient.getQueryData(row)?.seq ?? -1) < seq) {
        void queryClient.invalidateQueries({ exact: true, queryKey: row });
      }
      const whole = library.items.get.queryKey({ input: { id } });
      if ((queryClient.getQueryData(whole)?.seq ?? -1) < seq) {
        void queryClient.invalidateQueries({ exact: true, queryKey: whole });
      }
    }
    void queryClient.invalidateQueries({ queryKey: library.listing.key() });
  }
  if (moved.folders) {
    void queryClient.invalidateQueries({ queryKey: library.listing.scopes.key() });
  }
  if (moved.threads === "all" || moved.threads.length > 0) {
    void queryClient.invalidateQueries({ queryKey: library.agent.list.key() });
    void queryClient.invalidateQueries({ queryKey: library.agent.undoable.key() });
  }
  if (moved.threads === "all") {
    void queryClient.invalidateQueries({ queryKey: library.agent.events.key() });
  } else {
    for (const threadId of moved.threads) {
      void queryClient.invalidateQueries({
        queryKey: library.agent.events.key({ input: { threadId } }),
      });
    }
  }
  return items;
};
