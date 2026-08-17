// The workspace's left rail: vault name + create actions on top, the file
// tree, and the sync status pill at the bottom. Width is a localStorage pref
// dragged at the right edge; the workspace owns the value.

import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";
import { FilePlusIcon, FolderPlusIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";
import {
  canSyncNow,
  syncBlockedReason,
  syncStateDotClass,
  syncStateLabel,
  useVaultStatus,
  useVaultTree,
} from "../vault-hooks";
import { FileTree, type TreeLoadState, type TreeOps } from "./file-tree";

/** A failed listing renders as "The vault could not be read", never as the
 *  empty vault it is indistinguishable from once the entries default to []. */
function treeLoadState(query: ReturnType<typeof useVaultTree>): TreeLoadState {
  if (query.isError) {
    return "failed";
  }
  return query.data === undefined ? "loading" : "loaded";
}

function SyncStatusPill({ onSyncNow }: { onSyncNow: () => void }) {
  const statusQuery = useVaultStatus();
  const status = statusQuery.data;
  if (status === undefined) {
    return <div className="h-6" />;
  }
  const canSync = canSyncNow(status);
  // The server's own sentence first — it names the file or the remote — then
  // the shared reason this state blocks a pass, then the plain invitation.
  const title = status.lastError ?? syncBlockedReason(status) ?? "Sync now";
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
      <span className={cn("size-1.5 rounded-full", syncStateDotClass(status))} />
      {syncStateLabel(status)}
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
          {treeQuery.data?.name ?? "Vault"}
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
          loadState={treeLoadState(treeQuery)}
          onRetry={() => void treeQuery.refetch()}
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
