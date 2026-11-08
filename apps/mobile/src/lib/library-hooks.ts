// The screens' reads of the account's library, each a TanStack Query over the cell's own rows, kept
// on the phone between launches so what was last read shows offline, and asked again whenever the
// socket says it moved: an item whole, the conversations and a thread's events; the reply the agent
// is writing from the socket, and a file's address from the file cache. The signed-in library comes
// down through one context the root provides, so no screen holds a runtime of its own.

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createContext, use, useEffect, useSyncExternalStore } from "react";
import type { V1Client } from "@repo/contract/cloud/v1";
import { isOrpcError } from "@repo/contract/cloud/v1/errors";
import type { PhoneLibrary } from "./compose-runtime";

export const LibraryContext = createContext<PhoneLibrary | null>(null);

export const useLibrary = (): PhoneLibrary => {
  const library = use(LibraryContext);
  if (library === null) {
    throw new Error("a library screen mounted outside the signed-in library");
  }
  return library;
};

type ItemAnswer = Awaited<ReturnType<V1Client["library"]["items"]["get"]>>;

export type ItemRead =
  | { readonly kind: "loading" }
  | { readonly kind: "held"; readonly item: ItemAnswer }
  // the cloud holds no such item
  | { readonly kind: "missing" }
  // never read on this phone, and the cloud cannot be reached
  | { readonly kind: "unreachable" };

export const useItem = (itemId: string): ItemRead => {
  const { queries } = useLibrary();
  const { data, error, fetchStatus } = useQuery(
    queries.library.items.get.queryOptions({ input: { id: itemId } }),
  );
  if (data !== undefined) {
    return { item: data, kind: "held" };
  }
  if (isOrpcError(error) && error.defined && error.code === "NOT_FOUND") {
    return { kind: "missing" };
  }
  return error === null && fetchStatus !== "paused" ? { kind: "loading" } : { kind: "unreachable" };
};

const THREADS_PAGE = 50;

// newest first, as the cell lists them, and the next page asked for at the list's end
export const useThreads = () => {
  const { queries } = useLibrary();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    queries.library.agent.list.infiniteOptions({
      getNextPageParam: (page) => page.cursor ?? undefined,
      initialPageParam: undefined,
      input: (cursor: string | undefined) => ({ cursor, limit: THREADS_PAGE }),
    }),
  );
  return {
    more: () => {
      if (hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    },
    threads: data?.pages.flatMap((page) => page.threads),
  };
};

const EVENTS_PAGE = 500;

// a thread's stored events, every page of them, in order
export const useThreadEvents = (threadId: string) => {
  const { queries } = useLibrary();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    queries.library.agent.events.infiniteOptions({
      getNextPageParam: (page) => (page.more ? page.events.at(-1)?.idx : undefined),
      initialPageParam: undefined,
      input: (after: number | undefined) => ({ after, limit: EVENTS_PAGE, threadId }),
    }),
  );
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);
  return data?.pages.flatMap((page) => page.events);
};

// the title every live item goes by, by id, as an approval names what it would change
export const useTitles = (): ReadonlyMap<string, string> => {
  const { queries } = useLibrary();
  const { data } = useQuery(queries.library.listing.titles.queryOptions());
  return new Map(data?.targets.map(({ id, title }) => [id, title]));
};

// the reply the agent is writing in `threadId`, as the socket carries it
export const usePreview = (threadId: string): string | null => {
  const { previews } = useLibrary();
  return useSyncExternalStore(previews.subscribe, () => previews.get(threadId));
};

// where a file draws from on this phone, or a card's cover drawn small: undefined while it is
// asked for, null while it cannot be had (offline, before it was ever drawn here), which is asked
// again once the phone is back online. An address is this launch's, so none is kept
export const useFileUri = (sha: string | null, small = false): string | null | undefined => {
  const { files } = useLibrary();
  const { data } = useQuery({
    enabled: sha !== null,
    meta: { persist: false },
    networkMode: "always",
    queryFn: async () => {
      if (sha === null) {
        return null;
      }
      return small ? await files.thumbUri(sha) : await files.fileUri(sha);
    },
    queryKey: ["file", sha, small],
    refetchOnReconnect: "always",
    staleTime: Number.POSITIVE_INFINITY,
  });
  return data;
};
