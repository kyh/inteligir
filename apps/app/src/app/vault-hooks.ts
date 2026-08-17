// Server-state hooks over the typed client: the tree, the sync status and the
// system status as queries (invalidated by the ws bus), plus the mutation
// helpers the tree, palette and settings share. Mutations do not invalidate —
// every vault mutation is announced on the bus by the server, which is the
// one invalidation path a second client gets too.

import { useQuery } from "@tanstack/react-query";
import type { VaultStatusResponse, VaultTreeResponse } from "@repo/server-contract/vault";
import type { SystemStatusResponse } from "@repo/server-contract/routes";
import { unwrap } from "./api";
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

export function useSystemStatus() {
  const { api } = useWorkspace();
  return useQuery<SystemStatusResponse>({
    queryKey: queryKeys.systemStatus,
    queryFn: async () => unwrap(await api.system.status.$get()),
  });
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
    const name = n === 1 ? "Untitled.md" : `Untitled ${n}.md`;
    const path = parentDir === "" ? name : `${parentDir}/${name}`;
    if (!existing.has(path.toLowerCase())) {
      return path;
    }
  }
}
