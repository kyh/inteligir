// The screens' reads of the account's library, each a TanStack Query over the cell's own rows, kept
// on the phone between launches so what was last read shows offline, and asked again whenever an
// answer of what moved names it: an item whole, the conversations and a thread's events; a file's
// address from the file cache; and Move to Deleted, the one write two screens make. The signed-in library comes down through one context the root
// provides, so no screen holds a runtime of its own.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, use } from "react";
import { Alert } from "react-native";
import { threadQueries } from "@repo/client/thread-queries";
import { UNREACHABLE } from "@repo/contract/rpc/call-outcome";
import { refusalText } from "@repo/contract/rpc/refusal-text";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { isOrpcError } from "@repo/contract/rpc/v1-errors";
import { online } from "../ui/needs-connection";
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

// an item moved to Deleted on every device; false, and the person told why, when it stayed
export const useMoveToDeleted = (): ((itemId: string) => Promise<boolean>) => {
  const { newId, queries } = useLibrary();
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation(
    queries.library.items.delete.mutationOptions({
      onSettled: async () => {
        await queryClient.invalidateQueries({ queryKey: queries.library.key() });
      },
    }),
  );
  return async (itemId) => {
    if (!online()) {
      return false;
    }
    try {
      await mutateAsync({ ids: [itemId], opId: newId() });
      return true;
    } catch (error) {
      Alert.alert("Couldn't move it to Deleted", refusalText(error, UNREACHABLE));
      return false;
    }
  };
};

// every conversation of the account, newest first as the cell lists them
export const useThreads = () => {
  const { client, queries } = useLibrary();
  return useQuery(threadQueries({ client, orpc: queries }).threads()).data?.threads;
};

// a thread's events in order as they happen, and the reply as it is written
export const useThreadEvents = (threadId: string) => {
  const { client, queries } = useLibrary();
  return useQuery(threadQueries({ client, orpc: queries }).threadEvents(threadId)).data;
};

// where a file draws from on this phone, whole or as a card's cover: undefined while it is asked
// for, null while it cannot be had (offline, before it was ever drawn here), which is asked again
// once the phone is back online, and null for a cover a row will not draw. An address is this
// launch's, so none is kept
export const useFileUri = (sha: string | null, asCover = false): string | null | undefined => {
  const { files } = useLibrary();
  const { data } = useQuery({
    enabled: sha !== null,
    meta: { persist: false },
    networkMode: "always",
    queryFn: async () => {
      if (sha === null) {
        return null;
      }
      return asCover ? await files.coverUri(sha) : await files.fileUri(sha);
    },
    queryKey: ["file", sha, asCover],
    refetchOnReconnect: "always",
    staleTime: Number.POSITIVE_INFINITY,
  });
  return data;
};
