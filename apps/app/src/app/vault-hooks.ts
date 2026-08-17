// Server-state hooks over the typed client: the tree, the sync status and the
// system status as queries (invalidated by the ws bus), plus the mutation
// helpers the tree, palette and settings share. Mutations do not invalidate —
// every vault mutation is announced on the bus by the server, which is the
// one invalidation path a second client gets too.

import { useQuery } from "@tanstack/react-query";
import { DEFAULT_DOC_EXTENSION, isDocPath } from "@repo/notes/knowledge/doc-file";
import type { ApiClient } from "@repo/server-contract/client";
import type { VaultStatusResponse, VaultTreeResponse } from "@repo/server-contract/vault";
import type { SystemStatusResponse } from "@repo/server-contract/routes";
import { ApiError, unwrap } from "./api";
import { queryKeys } from "./api";
import { useWorkspace } from "./workspace-context";

export function useVaultTree() {
  const { api } = useWorkspace();
  return useQuery<VaultTreeResponse>({
    queryKey: queryKeys.vaultTree,
    queryFn: async () => unwrap(await api.vault.tree.$get()),
  });
}

export function useVaultStatus() {
  const { api } = useWorkspace();
  return useQuery<VaultStatusResponse>({
    queryKey: queryKeys.vaultStatus,
    queryFn: async () => unwrap(await api.vault.status.$get()),
  });
}

/** The one query the ws bus does NOT sweep — no change message names it, and
 *  uptime moves on its own — so it opts out of the fresh-forever default and
 *  re-reads whenever a consumer mounts. */
export function useSystemStatus() {
  const { api } = useWorkspace();
  return useQuery<SystemStatusResponse>({
    queryKey: queryKeys.systemStatus,
    queryFn: async () => unwrap(await api.system.status.$get()),
    staleTime: 0,
  });
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
    case "conflict":
      return `Conflict (${status.conflict.files.length})`;
    case "broken":
      return "Sync broken — manual repair needed";
  }
}

/**
 * Whether "Sync now" would actually start a pass. THREE surfaces offer the
 * command (the sidebar pill, the palette, the settings dialog), and a state
 * each of them judges for itself is a state one of them forgets — leaving a
 * live button that fires a request no pass can answer.
 */
export function canSyncNow(status: VaultStatusResponse | undefined): boolean {
  return (
    status !== undefined &&
    status.state !== "no-remote" &&
    status.state !== "syncing" &&
    status.state !== "held"
  );
}

/** A refused rename, with the sentence to show for it. */
export type RenameOutcome = { ok: true } | { ok: false; message: string };

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
  api: ApiClient,
  from: string,
  to: string,
): Promise<RenameOutcome> {
  try {
    await unwrap(await api.vault.rename.$post({ json: { from, to } }));
    return { ok: true };
  } catch (error) {
    // A failure with no contract body (a dropped connection) has no message
    // of the server's to render.
    return {
      ok: false,
      message: error instanceof ApiError ? error.message : `Could not rename ${from}.`,
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
