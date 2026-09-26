// Mutations do not invalidate: the server announces every vault mutation on
// the ws bus.

import { useCallback } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { RenameResult } from "@repo/editor/note/vault-session";
import { toast } from "@repo/ui/components/sonner";
import { freeDocPath, isVaultMetadataPath } from "@repo/notes/knowledge/doc-file";
import type { KnowledgeWikiTargetsResponse } from "@repo/api/local/knowledge/knowledge-schema";
import type { DataDirScope } from "@repo/api/local/system/system-schema";
import { externalSyncName } from "@repo/api/local/vault/vault-schema";
import type {
  VaultEntry,
  VaultStatusResponse,
  VaultTreeResponse,
} from "@repo/api/local/vault/vault-schema";
import { orpc, refusalMessage } from "./api";

export const useVaultTree = () => useQuery(orpc.vault.tree.queryOptions());

// The note session's read of the query the rail observes, so one change costs one walk: it joins
// a refetch already in flight, and otherwise walks afresh, because the session re-lists right
// after its own create, rename or delete, before the frame that invalidates the tree arrives.
export const readVaultTree = async (queryClient: QueryClient): Promise<VaultTreeResponse> =>
  await queryClient.query({ ...orpc.vault.tree.queryOptions(), staleTime: 0 });

export const useWikiTargets = () => useQuery(orpc.knowledge.wikiTargets.queryOptions());

// The cached listing while nothing has invalidated it; after a vault change, the refetch that
// change set off, joined rather than duplicated.
export const readWikiTargets = async (
  queryClient: QueryClient,
): Promise<KnowledgeWikiTargetsResponse> =>
  await queryClient.query(orpc.knowledge.wikiTargets.queryOptions());

// the index's answer, not the open buffer's: every surface that shows a pin agrees on one source
export const usePinnedPaths = (): ReadonlySet<string> => {
  const query = useWikiTargets();
  const targets = query.data?.targets ?? [];
  return new Set(targets.filter((target) => target.pinned === true).map((target) => target.path));
};

// a listing by path, not a search: the family's first `limit` notes and the whole count
export const useNotesWithTag = (tag: string, limit: number) =>
  useQuery(orpc.knowledge.tagNotes.queryOptions({ input: { limit, tag } }));

export const useVaultStatus = () => useQuery(orpc.vault.status.queryOptions());

// No change kind names this query, so it re-reads on every mount.
export const useSystemStatus = () =>
  useQuery({ ...orpc.system.status.queryOptions(), staleTime: 0 });

// undefined until the status answers; the sections say nothing rather than guess
export const useDataDirScope = (): DataDirScope | undefined => useSystemStatus().data?.dataDirScope;

// Every sentence here is the user's, never the engine's: its own error text names git's
// machinery, so the rail and a toast never show it, and Settings › Advanced shows it raw.
const SYNC_PAUSED = "Sync paused";
const DETAILS_IN_ADVANCED = "Details in Settings › Advanced.";
const STUCK = `Sync can't continue on its own. ${DETAILS_IN_ADVANCED}`;

export const syncStateLabel = (status: VaultStatusResponse): string => {
  switch (status.state) {
    case "no-remote": {
      return status.externalSync === null
        ? "Only on this Mac"
        : `Synced by ${externalSyncName(status.externalSync)}`;
    }
    case "clean": {
      return "Synced";
    }
    case "dirty": {
      return "Not synced yet";
    }
    case "syncing": {
      return "Syncing…";
    }
    case "held": {
      return "Waiting for the agent";
    }
    case "offline": {
      return "Offline";
    }
    case "unauthorized": {
      return status.remoteSource === "account" ? "Signed out of sync" : SYNC_PAUSED;
    }
    case "too-large": {
      return status.remoteSource === "account" ? "Too large to sync" : SYNC_PAUSED;
    }
    case "account-mismatch": {
      return "This vault belongs to a different account";
    }
    case "rejected":
    case "detached":
    case "broken": {
      return SYNC_PAUSED;
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};

export const syncStateDotClass = (status: VaultStatusResponse): string => {
  switch (status.state) {
    case "no-remote": {
      return "bg-muted-foreground/40";
    }
    case "clean": {
      return "bg-success";
    }
    case "dirty": {
      return "bg-amber-500";
    }
    case "syncing": {
      return "bg-sky-500 animate-pulse";
    }
    case "held": {
      return "bg-sky-500";
    }
    case "offline": {
      return "bg-muted-foreground/60";
    }
    case "unauthorized":
    case "rejected":
    case "too-large":
    case "account-mismatch":
    case "detached":
    case "broken": {
      return "bg-destructive";
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};

// no pass runs in these states, so a sync asked for now would report one that never happened
export const canSyncNow = (status: VaultStatusResponse | undefined): boolean => {
  if (status === undefined) {
    return false;
  }
  switch (status.state) {
    case "no-remote":
    case "syncing":
    case "held":
    case "account-mismatch": {
      return false;
    }
    case "clean":
    case "dirty":
    case "offline":
    case "unauthorized":
    case "rejected":
    case "too-large":
    case "detached":
    case "broken": {
      return true;
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};

// `warning` and `error` are the states the user has to act on, or ask Settings › Advanced about.
interface SyncStateNote {
  tone: "info" | "warning" | "error";
  message: string;
}

// The line under the rail's sync row, and what a sync the user asked for says when it ends in this
// state. Null only where silence is the answer: a sync that worked, or edits still on their way.
export const syncStateNote = (status: VaultStatusResponse): SyncStateNote | null => {
  switch (status.state) {
    case "no-remote": {
      return status.externalSync === null
        ? { message: "Sign in to sync your notes across devices.", tone: "info" }
        : {
            message: `${externalSyncName(status.externalSync)} syncs this folder, so Inteligir leaves its sync to it.`,
            tone: "info",
          };
    }
    case "clean":
    case "dirty": {
      return null;
    }
    case "syncing": {
      return { message: "A sync is already running.", tone: "info" };
    }
    case "held": {
      return { message: "Syncs when the agent finishes.", tone: "info" };
    }
    case "offline": {
      return { message: "Offline — syncs when you're back.", tone: "info" };
    }
    case "unauthorized": {
      return {
        message:
          status.remoteSource === "account"
            ? "This Mac was signed out of sync. Sign in again in Settings."
            : `Your sync server refused this Mac. ${DETAILS_IN_ADVANCED}`,
        tone: "error",
      };
    }
    case "too-large": {
      return {
        message:
          status.remoteSource === "account"
            ? "Your vault is larger than your account can sync."
            : `Your vault is too large for your sync server. ${DETAILS_IN_ADVANCED}`,
        tone: "error",
      };
    }
    case "account-mismatch": {
      return {
        message:
          "This vault last synced with a different account — sign out, or move the vault aside.",
        tone: "warning",
      };
    }
    case "detached": {
      return { message: STUCK, tone: "warning" };
    }
    case "rejected":
    case "broken": {
      return { message: STUCK, tone: "error" };
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};

// the rail offers Sync details… on these, which opens Settings › Advanced
export const syncNeedsAttention = (status: VaultStatusResponse): boolean => {
  const note = syncStateNote(status);
  return note !== null && note.tone !== "info";
};

export interface SyncNowHandle {
  syncNow: () => void;
  inFlight: boolean;
}

// `useIsMutating` over the procedure's key rather than `isPending`: each
// caller mounts its own useMutation, so isPending would answer only for the
// affordance that was clicked.
export const useSyncNow = (): SyncNowHandle => {
  const queryClient = useQueryClient();
  const { mutate } = useMutation(
    orpc.vault.syncNow.mutationOptions({
      onError: () => {
        toast.error("Sync failed.");
      },
      onSuccess: (status) => {
        queryClient.setQueryData(orpc.vault.status.queryKey(), status);
        const note = syncStateNote(status);
        if (note !== null) {
          toast[note.tone](note.message);
        }
      },
    }),
  );
  const inFlight = useIsMutating({ mutationKey: orpc.vault.syncNow.mutationKey() }) > 0;
  const syncNow = useCallback((): void => {
    mutate();
  }, [mutate]);
  return { inFlight, syncNow };
};

export interface RenameVaultApi {
  vault: {
    rename: (input: { from: string; to: string }) => Promise<{ path: string; rewritten: string[] }>;
  };
}

export const renameVaultEntry = async (
  api: RenameVaultApi,
  from: string,
  to: string,
): Promise<RenameResult> => {
  try {
    await api.vault.rename({ from, to });
    return { ok: true };
  } catch (error) {
    return { error: refusalMessage(error, `Could not rename ${from}.`), ok: false };
  }
};

// what the user wrote, which every listing draws; the server's listing stays complete for the
// CLI and the agent
export const visibleEntries = (entries: readonly VaultEntry[]): VaultEntry[] =>
  entries.filter((entry) => !isVaultMetadataPath(entry.path));

export const vaultFolders = (entries: readonly VaultEntry[]): string[] =>
  visibleEntries(entries)
    .filter((entry) => entry.kind === "dir")
    .map((entry) => entry.path);

// Lowercased: the disk may be case-insensitive, so name generation must be too.
export const filePathsLowercased = (tree: VaultTreeResponse | undefined): Set<string> => {
  const paths = new Set<string>();
  for (const entry of tree?.entries ?? []) {
    if (entry.kind === "file") {
      paths.add(entry.path.toLowerCase());
    }
  }
  return paths;
};

export const untitledNotePath = (parentDir: string, existing: Set<string>): string =>
  freeDocPath(parentDir, "Untitled", existing);
