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

export const useLibrary = () => {
  const library = use(LibraryContext);

  if (library === null) {
    throw new Error("a library screen mounted outside the signed-in library");
  }

  return library;
};

type ItemAnswer = Awaited<ReturnType<V1Client["library"]["items"]["get"]>>;

type ItemRead =
  | { readonly kind: "loading" }
  | { readonly kind: "held"; readonly item: ItemAnswer }
  | { readonly kind: "missing" }
  | { readonly kind: "unreachable" };

export const useItem = (itemId: string) => {
  const { queries } = useLibrary();

  const { data, error, fetchStatus } = useQuery(
    queries.library.items.get.queryOptions({ input: { id: itemId } }),
  );

  if (data !== undefined) {
    return { item: data, kind: "held" } satisfies ItemRead;
  }

  if (isOrpcError(error) && error.defined && error.code === "NOT_FOUND") {
    return { kind: "missing" } satisfies ItemRead;
  }

  return (
    error === null && fetchStatus !== "paused" ? { kind: "loading" } : { kind: "unreachable" }
  ) satisfies ItemRead;
};

export const useMoveToDeleted = () => {
  const { newId, queries } = useLibrary();
  const queryClient = useQueryClient();

  const { mutateAsync } = useMutation(
    queries.library.items.delete.mutationOptions({
      onSettled: async () => {
        await queryClient.invalidateQueries({ queryKey: queries.library.key() });
      },
    }),
  );

  return (async (itemId) => {
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
  }) satisfies (itemId: string) => Promise<boolean>;
};

export const useThreads = () => {
  const { client, queries } = useLibrary();

  return useQuery(threadQueries({ client, orpc: queries }).threads()).data?.threads;
};

export const useThreadEvents = (threadId: string) => {
  const { client, queries } = useLibrary();

  return useQuery(threadQueries({ client, orpc: queries }).threadEvents(threadId)).data;
};

export const useFileUri = (sha: string | null, asCover = false) => {
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
