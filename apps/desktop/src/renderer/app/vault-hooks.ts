// Server-state hooks over the typed client: the tree, the sync status and the
// system status as queries (invalidated by the ws bus), plus the mutation
// helpers the tree, palette and settings share. Mutations do not invalidate —
// every vault mutation is announced on the bus by the server, which is the
// one invalidation path a second client gets too.

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@repo/ui/components/sonner";
import { DEFAULT_DOC_EXTENSION, isDocPath } from "@repo/notes/knowledge/doc-file";
import type { VaultStatusResponse, VaultTreeResponse } from "@repo/api/local/vault/vault-schema";
import { orpc, refusalMessage } from "./api";
import { useWorkspace } from "./workspace-context";

export function useVaultTree() {
  return useQuery(orpc.vault.tree.queryOptions());
}

/** The knowledge index's alias-carrying wiki targets — ONE query for the
 *  picker, the pinned section, the composer's @-mentions and the provider's
 *  resolver. Lives in the `knowledge` family, so the files-changed /
 *  content-changed sweeps invalidate it; react-query's structural sharing
 *  keeps the reference stable when the payload is unchanged. */
export function useWikiTargets() {
  return useQuery(orpc.knowledge.wikiTargets.queryOptions());
}

export function useVaultStatus() {
  return useQuery(orpc.vault.status.queryOptions());
}

/** The one query the ws bus does NOT sweep — no change message names it, and
 *  uptime moves on its own — so it opts out of the fresh-forever default and
 *  re-reads whenever a consumer mounts. */
export function useSystemStatus() {
  return useQuery({ ...orpc.system.status.queryOptions(), staleTime: 0 });
}

/**
 * What a sync state is CALLED. Same reason as `canSyncNow` below, one step
 * further in: two tables over the same eight states drifted on half of them,
 * so one vault answered "Waiting on the agent" in the sidebar and "Waiting on
 * an agent turn" in settings, "Sync broken" in one and "Broken — manual
 * repair needed" in the other. A user comparing two pieces of the same
 * window cannot tell a wording difference from a state difference.
 *
 * The pill is the narrow surface, so the sentence is sized for it; what
 * settings has and the pill does not is `lastError`, which it already shows
 * beneath this label.
 */
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
      return "Not authorized — re-pair this device";
    case "conflict":
      return `Conflict (${status.conflict.files.length})`;
    case "broken":
      return "Sync broken — manual repair needed";
  }
}

/**
 * What a sync state LOOKS like. Beside the label rather than in the surface
 * that draws it, and for the reason above rather than for tidiness: these are
 * two total tables over the same eight states, so a ninth state added in one
 * file and forgotten in the other is a pill whose colour contradicts its own
 * word. Exhaustiveness cannot catch that — both tables typecheck perfectly
 * while saying different things — so what catches it is that they are here
 * together, and tools/repo-guards/src/domain-dispatch.test.ts fails when a
 * third one appears somewhere else.
 */
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
    case "conflict":
    case "broken":
      return "bg-destructive";
  }
}

/**
 * WHY "Sync now" would do nothing right now, or null when it would run.
 *
 * The same reason as the two tables above, one question further out: three
 * surfaces ask this and each was answering half of it in its own words. The
 * sidebar pill spelled "No git remote configured" and "An agent turn holds the
 * vault…" in a tooltip; the settings dialog spelled the first one differently
 * a few lines away; the palette gates the command and then fires it blind, so
 * the pass that refuses has to say so in a toast. Three partial tables over
 * eight states is the drift the co-located pair was written to stop — just
 * spread across three files instead of two.
 */
export function syncBlockedReason(status: VaultStatusResponse): string | null {
  switch (status.state) {
    case "no-remote":
      return "No git remote configured";
    case "syncing":
      return "A sync is already running";
    case "held":
      return "An agent turn holds the vault; the next sync runs when it finishes";
    case "clean":
    case "dirty":
    case "offline":
    case "unauthorized":
    case "conflict":
    case "broken":
      return null;
  }
}

/**
 * Whether "Sync now" would actually start a pass — the same answer as
 * `syncBlockedReason`, read as a boolean, so a state can never be blocked
 * without a sentence or explained without being blocked.
 */
export function canSyncNow(status: VaultStatusResponse | undefined): boolean {
  return status !== undefined && syncBlockedReason(status) === null;
}

/** A toast the "Sync now" command owes the user, with the tone it carries. */
interface SyncNowNotice {
  tone: "info" | "warning" | "error";
  message: string;
}

/**
 * What a "Sync now" pass has to SAY about the state it landed in, or null when
 * silence is honest — the pill has already changed and a toast would only
 * repeat it. Total over the states on purpose: silence is indistinguishable
 * from a sync that worked, so a ninth state must be made to answer here rather
 * than defaulting into nothing.
 */
/**
 * The one "Sync now" verb, shared by the workspace's palette command and the
 * settings page — two callers, one spelling of the mutation, the optimistic
 * status write and the notice policy.
 */
export function useSyncNow(): () => void {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  return useCallback((): void => {
    void (async () => {
      try {
        const status = await api.vault.syncNow();
        queryClient.setQueryData(orpc.vault.status.queryKey(), status);
        const notice = syncNowNotice(status);
        if (notice !== null) {
          toast[notice.tone](notice.message);
        }
      } catch {
        toast.error("Sync failed.");
      }
    })();
  }, [api, queryClient]);
}

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
        message: "The remote refused this device's credential — re-pair in Settings → Devices.",
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
      // Answered by the blocked branch above; listed so the switch stays total.
      return null;
  }
}

/** A refused rename, with the sentence to show for it. */
export type RenameOutcome = { ok: true } | { ok: false; message: string };

/** The one procedure a rename reaches, structurally — so a caller (and a test)
 *  hands over what this function uses rather than the whole client. */
export interface RenameVaultApi {
  vault: {
    rename(input: { from: string; to: string }): Promise<{ path: string; rewritten: string[] }>;
  };
}

/**
 * Rename a vault entry, reporting the SERVER'S refusal. Two surfaces rename
 * (the sidebar tree and the page-title H1), and copy each of them writes for
 * itself discards a message the contract already carries — the server names
 * which target exists, or which parent a file shadows, and neither surface
 * could say that. Worse, it forks: the server can improve its refusal and no
 * user ever sees the better sentence.
 *
 * The caller shows the message and owns what else a rename means to it (the
 * open note follows, the title re-arms) — only the words are shared.
 */
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

/** The note a virgin boot opens: the first doc in the vault root, by the
 *  DOMAIN's definition of one. The server indexes, links and lists every
 *  extension `isDocPath` names, so a client rule of its own opens a vault
 *  whose root holds `README.txt` to an empty pane. */
export function firstRootDoc(tree: VaultTreeResponse | undefined): string | null {
  const entry = tree?.entries.find(
    (candidate) =>
      candidate.kind === "file" && !candidate.path.includes("/") && isDocPath(candidate.path),
  );
  return entry?.path ?? null;
}

/** The vault's file paths, lowercased for existence checks — the disk this
 *  runs on may be case-insensitive, so name generation must be too. */
export function filePathsLowercased(tree: VaultTreeResponse | undefined): Set<string> {
  const paths = new Set<string>();
  for (const entry of tree?.entries ?? []) {
    if (entry.kind === "file") {
      paths.add(entry.path.toLowerCase());
    }
  }
  return paths;
}

/** First of "Untitled.md", "Untitled 2.md", … not present in the folder. */
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
