// The screens' reads of the library this phone holds, each kept current with the replica's change
// feed: the listing from memory, an item, its highlights and the conversations from the replica's
// SQL (every one with this phone's unsent writes laid over, and every one offline), the reply the
// agent is writing from the socket, and a file's address from the file cache. The signed-in library
// comes down through one context the root provides, so no screen holds a runtime of its own.

import { createContext, use, useEffect, useState, useSyncExternalStore } from "react";
import type { ListingPage, ListingQuery } from "@repo/notes/library/library-index";
import type {
  LibraryReplica,
  ReplicaChange,
  ReplicaItem,
  ReplicaListingRow,
  ReplicaStatus,
} from "@repo/library-replica/library-replica";
import type { AnnotationStore } from "@repo/notes/annotations/store-schema";
import { watchFile } from "../files/watch-file";
import type { PhoneLibrary } from "./compose-runtime";

export const LibraryContext = createContext<PhoneLibrary | null>(null);

export const useLibrary = (): PhoneLibrary => {
  const library = use(LibraryContext);
  if (library === null) {
    throw new Error("a library screen mounted outside the signed-in library");
  }
  return library;
};

// a count that moves whenever the replica says something changed that `moved` cares about
const useChanges = (moved: (change: ReplicaChange) => boolean): number => {
  const { replica } = useLibrary();
  const [version, setVersion] = useState(0);
  useEffect(
    () =>
      replica.onChange((change) => {
        if (change.reset || moved(change)) {
          setVersion((count) => count + 1);
        }
      }),
    [moved, replica],
  );
  return version;
};

const anyItem = (change: ReplicaChange): boolean =>
  change.kinds.has("item") || change.kinds.has("folder") || change.kinds.has("annotation");

// the listing is the replica's memory, which moves under a render, so the change it is read after
// is an argument: the React Compiler keys a call on its arguments, and drops a memo dependency the
// body does not read, which would leave the list as it was at the last change of query
const listingAfter = (
  replica: LibraryReplica,
  query: ListingQuery,
  _change: number,
): ListingPage<ReplicaListingRow> => replica.listing(query);

export const useListing = (query: ListingQuery): ListingPage<ReplicaListingRow> => {
  const { replica } = useLibrary();
  const change = useChanges(anyItem);
  return listingAfter(replica, query, change);
};

export const useReplicaStatus = (): ReplicaStatus => {
  const { replica } = useLibrary();
  return useSyncExternalStore(replica.onStatus, replica.status);
};

// an async read of the replica, asked again whenever a change names what it read; undefined while
// the first answer is on its way
const useReplicaRead = <T>(
  key: string,
  read: () => Promise<T>,
  moved: (change: ReplicaChange) => boolean,
): T | undefined => {
  const version = useChanges(moved);
  const [answer, setAnswer] = useState<{ key: string; version: number; value: T } | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const value = await read();
      if (live) {
        setAnswer({ key, value, version });
      }
    })();
    return () => {
      live = false;
    };
  }, [key, read, version]);
  return answer?.key === key ? answer.value : undefined;
};

export const useItem = (itemId: string): ReplicaItem | null | undefined => {
  const { replica } = useLibrary();
  return useReplicaRead(
    `item:${itemId}`,
    async () => await replica.item(itemId),
    (change) => change.ids.has(itemId),
  );
};

export const useAnnotations = (itemId: string): AnnotationStore | undefined => {
  const { replica } = useLibrary();
  return useReplicaRead(
    `annotations:${itemId}`,
    async () => await replica.annotations(itemId),
    (change) => change.ids.has(itemId),
  );
};

const anyThread = (change: ReplicaChange): boolean =>
  change.kinds.has("thread") || change.kinds.has("thread_event");

export const useThreads = () => {
  const { replica } = useLibrary();
  return useReplicaRead("threads", replica.threads, anyThread);
};

export const useThreadEvents = (threadId: string) => {
  const { replica } = useLibrary();
  return useReplicaRead(
    `events:${threadId}`,
    async () => await replica.threadEvents(threadId),
    anyThread,
  );
};

// the reply the agent is writing in `threadId`, as the socket carries it
export const usePreview = (threadId: string): string | null => {
  const { previews } = useLibrary();
  return useSyncExternalStore(previews.subscribe, () => previews.get(threadId));
};

// where a file draws from on this phone, or a card's cover drawn small: undefined while it is
// asked for, null while it cannot be had (offline, before it was ever drawn here), which comes
// right once the library can be reached
export const useFileUri = (sha: string | null, small = false): string | null | undefined => {
  const { files, replica } = useLibrary();
  const [held, setHeld] = useState<{ sha: string; uri: string | null } | null>(null);
  useEffect(() => {
    if (sha === null) {
      return;
    }
    return watchFile({
      ask: async () => (small ? await files.thumbUri(sha) : await files.fileUri(sha)),
      replica,
      told: (uri) => {
        setHeld({ sha, uri });
      },
    });
  }, [files, replica, sha, small]);
  return held?.sha === sha ? held.uri : undefined;
};
