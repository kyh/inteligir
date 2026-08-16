// The workspace's left rail: vault name + create actions on top, the file
// tree, and the sync status pill at the bottom. Width is a localStorage pref
// dragged at the right edge; the workspace owns the value.

import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";
import type { VaultStatusResponse } from "@repo/server-contract/vault";
import { FilePlusIcon, FolderPlusIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";
import { useVaultStatus, useVaultTree } from "../vault-hooks";
import { FileTree, type TreeOps } from "./file-tree";

function vaultName(root: string | undefined): string {
  if (root === undefined) {
    return "Vault";
  }
  const segments = root.split("/").filter((segment) => segment !== "");
  return segments.at(-1) ?? "Vault";
}

function syncPillLabel(status: VaultStatusResponse): string {
  switch (status.state) {
    case "no-remote":
      return "Local only";
    case "clean":
      return "Synced";
    case "dirty":
      return "Unsynced changes";
    case "syncing":
      return "Syncing…";
    case "conflict":
      return `Conflict (${status.conflict.files.length})`;
    case "broken":
      return "Sync broken";
  }
}

function syncPillDotClass(status: VaultStatusResponse): string {
  switch (status.state) {
    case "no-remote":
      return "bg-muted-foreground/40";
    case "clean":
      return "bg-emerald-500";
    case "dirty":
      return "bg-amber-500";
    case "syncing":
      return "bg-sky-500 animate-pulse";
    case "conflict":
    case "broken":
      return "bg-destructive";
  }
}

function SyncStatusPill({ onSyncNow }: { onSyncNow: () => void }) {
  const statusQuery = useVaultStatus();
  const status = statusQuery.data;
  if (status === undefined) {
    return <div className="h-6" />;
  }
  const canSync = status.state !== "no-remote" && status.state !== "syncing";
  const title =
    status.lastError !== null
      ? status.lastError
      : status.state === "no-remote"
        ? "No git remote configured"
        : "Sync now";
  return (
    <button
      type="button"
      disabled={!canSync}
      title={title}
      onClick={onSyncNow}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs text-muted-foreground",
        canSync && "hover:bg-muted hover:text-foreground",
      )}
    >
      <span className={cn("size-1.5 rounded-full", syncPillDotClass(status))} />
      {syncPillLabel(status)}
    </button>
  );
}

export interface SidebarProps {
  openPath: string | null;
  onOpenFile: (path: string) => void;
  ops: TreeOps;
  onSyncNow: () => void;
  onOpenSettings: () => void;
}

export function Sidebar({ openPath, onOpenFile, ops, onSyncNow, onOpenSettings }: SidebarProps) {
  const treeQuery = useVaultTree();
  const [pendingCreate, setPendingCreate] = useState<{
    kind: "file" | "dir";
    parentDir: string;
  } | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-1 px-3 pt-3 pb-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
          {vaultName(treeQuery.data?.root)}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New note"
          onClick={() => setPendingCreate({ kind: "file", parentDir: "" })}
        >
          <FilePlusIcon className="size-4 text-muted-foreground" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New folder"
          onClick={() => setPendingCreate({ kind: "dir", parentDir: "" })}
        >
          <FolderPlusIcon className="size-4 text-muted-foreground" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FileTree
          entries={treeQuery.data?.entries ?? []}
          openPath={openPath}
          onOpenFile={onOpenFile}
          ops={ops}
          pendingCreate={pendingCreate}
          onPendingCreateHandled={() => setPendingCreate(null)}
        />
      </div>
      <footer className="flex items-center justify-between border-t border-border/60 px-2 py-1.5">
        <SyncStatusPill onSyncNow={onSyncNow} />
        <Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={onOpenSettings}>
          <SettingsIcon className="size-4 text-muted-foreground" />
        </Button>
      </footer>
    </div>
  );
}
