// The page's library, handed to every screen through one context: the replica the screens read and
// write, and the wire to the cell for what only the cell answers. Mounted once, above the router's
// routes, so Settings and back keeps the one replica, its socket and its outbox.

import type { LibraryReplica, ReplicaStatus } from "@repo/library-replica/library-replica";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useSyncExternalStore } from "react";

import type { LeaveGuard } from "./leave-guard";
import type { PageLibrary, SignedIn } from "./page-library";
import { followReplica, replicaQueries } from "./replica-queries";
import type { CloudWire } from "./v1";

const PageLibraryContext = createContext<PageLibrary | null>(null);

const usePageLibrary = (): PageLibrary => {
  const library = useContext(PageLibraryContext);
  if (library === null) {
    throw new Error("usePageLibrary must be used inside PageLibraryProvider");
  }
  return library;
};

export const useReplica = (): LibraryReplica => usePageLibrary().replica;

export const useWire = (): CloudWire => usePageLibrary().wire;

export const useAccount = (): SignedIn => usePageLibrary().account;

export const useLeaveGuard = (): LeaveGuard => usePageLibrary().leave;

export const useReplicaQueries = () => replicaQueries(useReplica());

// where the replica stands: syncing, what stopped it, the writes it holds; the replica keeps one
// status object until it moves, so the snapshot is cached
export const useReplicaStatus = (): ReplicaStatus => {
  const replica = useReplica();
  return useSyncExternalStore(replica.onStatus, replica.status);
};

export const PageLibraryProvider = ({
  library,
  children,
}: {
  library: PageLibrary;
  children: React.ReactNode;
}) => {
  const queryClient = useQueryClient();
  useEffect(() => followReplica(library.replica, queryClient), [library, queryClient]);
  return <PageLibraryContext value={library}>{children}</PageLibraryContext>;
};
