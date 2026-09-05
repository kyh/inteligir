// Mutations do not invalidate: the server announces every vault mutation on
// the ws bus.

import { useCallback } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@repo/ui/components/sonner";
import { DEFAULT_DOC_EXTENSION } from "@repo/notes/knowledge/doc-file";
import { KNOWLEDGE_SEARCH_MAX_LIMIT } from "@repo/api/local/knowledge/knowledge-schema";
import type { VaultStatusResponse, VaultTreeResponse } from "@repo/api/local/vault/vault-schema";
import { orpc, refusalMessage } from "./api";

export function useVaultTree() {
  return useQuery(orpc.vault.tree.queryOptions());
}

export function useWikiTargets() {
  return useQuery(orpc.knowledge.wikiTargets.queryOptions());
}

export function useTags(enabled: boolean) {
  return useQuery({ ...orpc.knowledge.tags.queryOptions(), enabled });
}

// the search route with a bare `tag:` term answers the tagged notes, sorted, cut at its ceiling
export function useNotesWithTag(tag: string | null) {
  return useQuery({
    ...orpc.knowledge.search.queryOptions({
      input: { q: tag === null ? "" : `tag:${tag}`, limit: KNOWLEDGE_SEARCH_MAX_LIMIT },
    }),
    enabled: tag !== null,
  });
}

export function useVaultStatus() {
  return useQuery(orpc.vault.status.queryOptions());
}

// No change kind names this query, so it re-reads on every mount.
export function useSystemStatus() {
  return useQuery({ ...orpc.system.status.queryOptions(), staleTime: 0 });
}

export function syncStateLabel(status: VaultStatusResponse): string {
  switch (status.state) {
    case "no-remote":
      return "Local only";
    case "clean":
      return "Synced";
    case "dirty":
      return "Unsynced changes";
    case "syncing":
      return "Syncing…";
    case "held":
      return "Waiting on an agent turn";
    case "offline":
      return "Offline";
    case "unauthorized":
      return "Not authorized — sign this device in again";
    case "account-mismatch":
      return "This vault belongs to a different account";
    case "conflict":
      return `Conflict (${status.conflict.files.length})`;
    case "broken":
      return "Sync broken — manual repair needed";
  }
}

export function syncStateDotClass(status: VaultStatusResponse): string {
  switch (status.state) {
    case "no-remote":
      return "bg-muted-foreground/40";
    case "clean":
      return "bg-emerald-500";
    case "dirty":
      return "bg-amber-500";
    case "syncing":
      return "bg-sky-500 animate-pulse";
    case "held":
      return "bg-sky-500";
    case "offline":
      return "bg-muted-foreground/60";
    case "unauthorized":
    case "account-mismatch":
    case "conflict":
    case "broken":
      return "bg-destructive";
  }
}

export function syncBlockedReason(status: VaultStatusResponse): string | null {
  switch (status.state) {
    case "no-remote":
      return "No git remote configured";
    case "syncing":
      return "A sync is already running";
    case "held":
      return "An agent turn holds the vault; the next sync runs when it finishes";
    case "account-mismatch":
      return "This vault last synced with a different account — sign out, or move the vault aside";
    case "clean":
    case "dirty":
    case "offline":
    case "unauthorized":
    case "conflict":
    case "broken":
      return null;
  }
}

export function canSyncNow(status: VaultStatusResponse | undefined): boolean {
  return status !== undefined && syncBlockedReason(status) === null;
}

interface SyncNowNotice {
  tone: "info" | "warning" | "error";
  message: string;
}

export interface SyncNowHandle {
  syncNow: () => void;
  inFlight: boolean;
}

// `useIsMutating` over the procedure's key rather than `isPending`: each
// caller mounts its own useMutation, so isPending would answer only for the
// affordance that was clicked.
export function useSyncNow(): SyncNowHandle {
  const queryClient = useQueryClient();
  const { mutate } = useMutation(
    orpc.vault.syncNow.mutationOptions({
      onSuccess: (status) => {
        queryClient.setQueryData(orpc.vault.status.queryKey(), status);
        const notice = syncNowNotice(status);
        if (notice !== null) {
          toast[notice.tone](notice.message);
        }
      },
      onError: () => {
        toast.error("Sync failed.");
      },
    }),
  );
  const inFlight = useIsMutating({ mutationKey: orpc.vault.syncNow.mutationKey() }) > 0;
  const syncNow = useCallback((): void => {
    mutate();
  }, [mutate]);
  return { syncNow, inFlight };
}

// Total over the states: silence is indistinguishable from a sync that worked.
function syncNowNotice(status: VaultStatusResponse): SyncNowNotice | null {
  const blocked = syncBlockedReason(status);
  if (blocked !== null) {
    return { tone: "info", message: `${blocked}.` };
  }
  switch (status.state) {
    case "conflict":
      return {
        tone: "warning",
        message: "Sync hit a conflict — both sides changed the same files.",
      };
    case "offline":
      return {
        tone: "error",
        message:
          status.lastError === null
            ? "Could not reach the git remote."
            : `Could not reach the git remote: ${status.lastError}`,
      };
    case "unauthorized":
      return {
        tone: "error",
        message:
          "The remote refused this device's credential — sign in again in Settings → Devices.",
      };
    case "clean":
    case "dirty":
    case "broken":
      return status.lastError === null
        ? null
        : { tone: "error", message: `Sync failed: ${status.lastError}` };
    case "no-remote":
    case "syncing":
    case "held":
    case "account-mismatch":
      // Answered by the blocked branch above.
      return null;
  }
}

export type RenameOutcome = { ok: true } | { ok: false; message: string };

export interface RenameVaultApi {
  vault: {
    rename(input: { from: string; to: string }): Promise<{ path: string; rewritten: string[] }>;
  };
}

export async function renameVaultEntry(
  api: RenameVaultApi,
  from: string,
  to: string,
): Promise<RenameOutcome> {
  try {
    await api.vault.rename({ from, to });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: refusalMessage(error, `Could not rename ${from}.`),
    };
  }
}

// Lowercased: the disk may be case-insensitive, so name generation must be too.
export function filePathsLowercased(tree: VaultTreeResponse | undefined): Set<string> {
  const paths = new Set<string>();
  for (const entry of tree?.entries ?? []) {
    if (entry.kind === "file") {
      paths.add(entry.path.toLowerCase());
    }
  }
  return paths;
}

export function untitledNotePath(parentDir: string, existing: Set<string>): string {
  for (let n = 1; ; n += 1) {
    const stem = n === 1 ? "Untitled" : `Untitled ${n}`;
    const name = `${stem}${DEFAULT_DOC_EXTENSION}`;
    const path = parentDir === "" ? name : `${parentDir}/${name}`;
    if (!existing.has(path.toLowerCase())) {
      return path;
    }
  }
}
