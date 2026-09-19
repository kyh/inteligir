// Mutations do not invalidate: the server announces every vault mutation on
// the ws bus.

import { useCallback } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@repo/ui/components/sonner";
import { freeDocPath, isVaultMetadataPath } from "@repo/notes/knowledge/doc-file";
import type { DataDirScope } from "@repo/api/local/system/system-schema";
import type {
  VaultEntry,
  VaultStatusResponse,
  VaultTreeResponse,
} from "@repo/api/local/vault/vault-schema";
import { orpc, refusalMessage } from "./api";

export const useVaultTree = () => useQuery(orpc.vault.tree.queryOptions());

export const useWikiTargets = () => useQuery(orpc.knowledge.wikiTargets.queryOptions());

// the index's answer, not the open buffer's: every surface that shows a pin agrees on one source
export const usePinnedPaths = (): ReadonlySet<string> => {
  const query = useWikiTargets();
  const targets = query.data?.targets ?? [];
  return new Set(targets.filter((target) => target.pinned === true).map((target) => target.path));
};

// a listing by path, not a search: the family's first `limit` notes and the whole count
export const useNotesWithTag = (tag: string | null, limit: number) =>
  useQuery({
    ...orpc.knowledge.tagNotes.queryOptions({ input: { limit, tag: tag ?? "none" } }),
    enabled: tag !== null,
  });

export const useVaultStatus = () => useQuery(orpc.vault.status.queryOptions());

// No change kind names this query, so it re-reads on every mount.
export const useSystemStatus = () =>
  useQuery({ ...orpc.system.status.queryOptions(), staleTime: 0 });

// undefined until the status answers; the sections say nothing rather than guess
export const useDataDirScope = (): DataDirScope | undefined => useSystemStatus().data?.dataDirScope;

export const syncStateLabel = (status: VaultStatusResponse): string => {
  switch (status.state) {
    case "no-remote": {
      return "Local only";
    }
    case "clean": {
      return "Synced";
    }
    case "dirty": {
      return "Unsynced changes";
    }
    case "syncing": {
      return "Syncing…";
    }
    case "held": {
      return "Waiting on an agent turn";
    }
    case "offline": {
      return "Offline";
    }
    case "unauthorized": {
      return "Not authorized — sign this device in again";
    }
    case "account-mismatch": {
      return "This vault belongs to a different account";
    }
    case "conflict": {
      return `Conflict (${status.conflict.files.length})`;
    }
    case "broken": {
      return "Sync broken — manual repair needed";
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
      return "bg-emerald-500";
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
    case "account-mismatch":
    case "conflict":
    case "broken": {
      return "bg-destructive";
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};

export const syncBlockedReason = (status: VaultStatusResponse): string | null => {
  switch (status.state) {
    case "no-remote": {
      return "No git remote configured";
    }
    case "syncing": {
      return "A sync is already running";
    }
    case "held": {
      return "An agent turn holds the vault; the next sync runs when it finishes";
    }
    case "account-mismatch": {
      return "This vault last synced with a different account — sign out, or move the vault aside";
    }
    case "clean":
    case "dirty":
    case "offline":
    case "unauthorized":
    case "conflict":
    case "broken": {
      return null;
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};

export const canSyncNow = (status: VaultStatusResponse | undefined): boolean =>
  status !== undefined && syncBlockedReason(status) === null;

interface SyncNowNotice {
  tone: "info" | "warning" | "error";
  message: string;
}

export interface SyncNowHandle {
  syncNow: () => void;
  inFlight: boolean;
}

// Total over the states: silence is indistinguishable from a sync that worked.
const syncNowNotice = (status: VaultStatusResponse): SyncNowNotice | null => {
  const blocked = syncBlockedReason(status);
  if (blocked !== null) {
    return { message: `${blocked}.`, tone: "info" };
  }
  switch (status.state) {
    case "conflict": {
      return {
        message: "Sync hit a conflict — both sides changed the same files.",
        tone: "warning",
      };
    }
    case "offline": {
      return {
        message:
          status.lastError === null
            ? "Could not reach the git remote."
            : `Could not reach the git remote: ${status.lastError}`,
        tone: "error",
      };
    }
    case "unauthorized": {
      return {
        message:
          "The remote refused this device's credential — sign in again in Settings → Devices.",
        tone: "error",
      };
    }
    case "clean":
    case "dirty":
    case "broken": {
      return status.lastError === null
        ? null
        : { message: `Sync failed: ${status.lastError}`, tone: "error" };
    }
    case "no-remote":
    case "syncing":
    case "held":
    case "account-mismatch": {
      // Answered by the blocked branch above.
      return null;
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};

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
        const notice = syncNowNotice(status);
        if (notice !== null) {
          toast[notice.tone](notice.message);
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

export type RenameOutcome = { ok: true } | { ok: false; message: string };

export interface RenameVaultApi {
  vault: {
    rename: (input: { from: string; to: string }) => Promise<{ path: string; rewritten: string[] }>;
  };
}

export const renameVaultEntry = async (
  api: RenameVaultApi,
  from: string,
  to: string,
): Promise<RenameOutcome> => {
  try {
    await api.vault.rename({ from, to });
    return { ok: true };
  } catch (error) {
    return {
      message: refusalMessage(error, `Could not rename ${from}.`),
      ok: false,
    };
  }
};

// the folders a user may pick: what the rail lists, so a dot-dir is hidden here too
export const vaultFolders = (entries: readonly VaultEntry[]): string[] =>
  entries
    .filter((entry) => entry.kind === "dir" && !isVaultMetadataPath(entry.path))
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
