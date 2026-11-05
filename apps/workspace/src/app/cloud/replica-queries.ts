// The replica's reads as TanStack queries. Each one reads this device's own rows, so it runs with
// no connection (`networkMode: "always"`) and never goes stale on a clock: the replica says what
// moved (`onChange`), and the queries over what moved are invalidated. The library's reads and the
// built-in agent's threads are two families, so an agent's streamed turn refetches no grid.

import type { LibraryReplica, ReplicaChange } from "@repo/library-replica/library-replica";
import type { ListingQuery } from "@repo/notes/library/library-index";
import { queryOptions } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

const LIBRARY = ["replica", "library"] as const;
const THREADS = ["replica", "threads"] as const;

const replicaKeys = {
  annotations: (itemId: string) => [...LIBRARY, "annotations", itemId] as const,
  folders: () => [...LIBRARY, "folders"] as const,
  item: (itemId: string) => [...LIBRARY, "item", itemId] as const,
  library: () => LIBRARY,
  listing: (query: ListingQuery) => [...LIBRARY, "listing", query] as const,
  scopes: () => [...LIBRARY, "scopes"] as const,
  search: (query: string, limit: number) => [...LIBRARY, "search", query, limit] as const,
  tags: () => [...LIBRARY, "tags"] as const,
  threadEvents: (threadId: string) => [...THREADS, "events", threadId] as const,
  threads: () => THREADS,
};

const replicaQuery = <T, K extends QueryKey>(queryKey: K, read: () => T | Promise<T>) =>
  queryOptions({
    networkMode: "always",
    queryFn: async () => await read(),
    queryKey,
    staleTime: Number.POSITIVE_INFINITY,
  });

// every tag the library's live items carry, with how many carry it, in the order a rail lists
// them: the most used first, then by name
export interface TagCount {
  readonly tag: string;
  readonly items: number;
}

const tagCounts = (replica: LibraryReplica): TagCount[] => {
  const all = replica.scopes().total;
  const page = replica.listing({
    deleted: false,
    limit: Math.max(1, all),
    offset: 0,
    sort: "saved",
  });
  const counts = new Map<string, TagCount>();
  for (const row of page.items) {
    for (const tag of row.tags) {
      const key = tag.toLowerCase();
      const held = counts.get(key);
      counts.set(key, { items: (held?.items ?? 0) + 1, tag: held?.tag ?? tag });
    }
  }
  return [...counts.values()].toSorted((a, b) => b.items - a.items || a.tag.localeCompare(b.tag));
};

export const replicaQueries = (replica: LibraryReplica) => ({
  annotations: (itemId: string) =>
    replicaQuery(replicaKeys.annotations(itemId), async () => await replica.annotations(itemId)),
  folders: () => replicaQuery(replicaKeys.folders(), () => replica.folders()),
  item: (itemId: string) =>
    replicaQuery(replicaKeys.item(itemId), async () => await replica.item(itemId)),
  listing: (query: ListingQuery) =>
    replicaQuery(replicaKeys.listing(query), () => replica.listing(query)),
  scopes: () => replicaQuery(replicaKeys.scopes(), () => replica.scopes()),
  search: (query: string, limit: number) =>
    replicaQuery(replicaKeys.search(query, limit), async () => await replica.search(query, limit)),
  tags: () => replicaQuery(replicaKeys.tags(), () => tagCounts(replica)),
  threadEvents: (threadId: string) =>
    replicaQuery(
      replicaKeys.threadEvents(threadId),
      async () => await replica.threadEvents(threadId),
    ),
  threads: () => replicaQuery(replicaKeys.threads(), async () => await replica.threads()),
});

const THREAD_KINDS = new Set(["thread", "thread_event"]);

// what a change moves: the library's reads, the threads', or both; a reset moves every one
export interface FamiliesMoved {
  readonly library: boolean;
  readonly threads: boolean;
}

export const familiesMoved = (change: ReplicaChange): FamiliesMoved => {
  if (change.reset) {
    return { library: true, threads: true };
  }
  const kinds = [...change.kinds];
  return {
    library: kinds.some((kind) => !THREAD_KINDS.has(kind)),
    threads: kinds.some((kind) => THREAD_KINDS.has(kind)),
  };
};

export const followReplica = (replica: LibraryReplica, queryClient: QueryClient): (() => void) =>
  replica.onChange((change) => {
    const moved = familiesMoved(change);
    if (moved.library) {
      void queryClient.invalidateQueries({ queryKey: replicaKeys.library() });
    }
    if (moved.threads) {
      void queryClient.invalidateQueries({ queryKey: replicaKeys.threads() });
    }
  });
