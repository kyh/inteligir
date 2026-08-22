// The workspace's left rail (Moss's IA) on the fluid sidebar anatomy: search
// + create actions on top, the recency-ordered NOTES LIST as the default view
// with the file tree one toggle away, and the sync status row at the bottom.
// The fluid provider owns width/collapse (workspace.tsx mounts it); this file
// owns only what fills the rail.

import { Button } from "@repo/ui/components/button";
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/components/sidebar";
import { cn } from "@repo/ui/lib/utils";
import {
  FilePlusIcon,
  FolderPlusIcon,
  FolderTreeIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { platformShortcutModifier } from "../global-shortcuts";
import {
  canSyncNow,
  syncBlockedReason,
  syncStateDotClass,
  syncStateLabel,
  useVaultStatus,
  useVaultTree,
} from "../vault-hooks";
import { FileTree, type TreeLoadState, type TreeOps } from "./file-tree";
import { NotesList } from "./notes-list";

/** A failed listing renders as "The vault could not be read", never as the
 *  empty vault it is indistinguishable from once the entries default to []. */
function treeLoadState(query: ReturnType<typeof useVaultTree>): TreeLoadState {
  if (query.isError) {
    return "failed";
  }
  return query.data === undefined ? "loading" : "loaded";
}

function SyncStatusRow({ onSyncNow }: { onSyncNow: () => void }) {
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
        // Hover steps an ink TIER rather than lighting a pill: a status line
        // that gains a background reads as a button it is only sometimes.
        "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs text-muted-foreground",
        canSync && "hover:text-foreground",
      )}
    >
      <span className={cn("size-1.5 rounded-full", syncStateDotClass(status))} />
      {syncStateLabel(status)}
    </button>
  );
}

export interface SidebarRailContentProps {
  openPath: string | null;
  onOpenFile: (path: string) => void;
  ops: TreeOps;
  onSyncNow: () => void;
  onOpenSettings: () => void;
  onOpenTrash: () => void;
  onOpenSearch: () => void;
}

export function SidebarRailContent({
  openPath,
  onOpenFile,
  ops,
  onSyncNow,
  onOpenSettings,
  onOpenTrash,
  onOpenSearch,
}: SidebarRailContentProps) {
  const treeQuery = useVaultTree();
  const [pendingCreate, setPendingCreate] = useState<{
    kind: "file" | "dir";
    parentDir: string;
  } | null>(null);
  // The default view is the notes list; the tree is a mode, not a page, so
  // flipping it loses nothing. Creating a folder needs the tree — the create
  // buttons switch it in.
  const [showTree, setShowTree] = useState(false);
  const modifier = platformShortcutModifier();

  return (
    <>
      <SidebarHeader className="gap-2">
        <div className="flex items-center gap-1">
          <h2 className="min-w-0 flex-1 truncate px-1 text-sm font-medium">
            {treeQuery.data?.name ?? "Vault"}
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New folder"
            onClick={() => {
              setShowTree(true);
              setPendingCreate({ kind: "dir", parentDir: "" });
            }}
          >
            <FolderPlusIcon className="size-4 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={showTree ? "Show notes list" : "Show file tree"}
            aria-pressed={showTree}
            onClick={() => {
              setShowTree((current) => !current);
            }}
          >
            <FolderTreeIcon
              className={cn("size-4", showTree ? "text-foreground" : "text-muted-foreground")}
            />
          </Button>
        </div>
        {/* The palette IS the search surface (⌘P); the input is its rail
            affordance, so it opens the palette instead of growing a second
            search UI. readOnly keeps the caret out of a field that never
            holds text. */}
        <div className="relative">
          <SidebarInput
            readOnly
            placeholder="Search…"
            aria-label="Search notes"
            onFocus={(event) => {
              event.currentTarget.blur();
              onOpenSearch();
            }}
            // preventDefault keeps the gesture's focus off the field (it
            // also cancels the compatibility click, so click can't be the
            // opener); the open waits for pointerup so the palette dialog
            // mounts after the gesture — a dialog mounted mid-gesture reads
            // that same gesture's release as an outside press and dismisses
            // itself.
            onPointerDown={(event) => {
              event.preventDefault();
            }}
            onPointerUp={onOpenSearch}
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted-foreground">
            {modifier === "meta" ? "⌘" : "Ctrl-"}P
          </kbd>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              icon={FilePlusIcon}
              onClick={() => {
                setShowTree(true);
                setPendingCreate({ kind: "file", parentDir: "" });
              }}
            >
              New note
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {showTree ? (
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
        ) : (
          <NotesList
            entries={treeQuery.data?.entries ?? []}
            openPath={openPath}
            onOpenFile={onOpenFile}
          />
        )}
      </SidebarContent>
      <SidebarFooter className="flex-row items-center justify-between">
        <SyncStatusRow onSyncNow={onSyncNow} />
        <div className="flex items-center">
          <Button variant="ghost" size="icon-sm" aria-label="Trash" onClick={onOpenTrash}>
            <Trash2Icon className="size-4 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={onOpenSettings}>
            <SettingsIcon className="size-4 text-muted-foreground" />
          </Button>
        </div>
      </SidebarFooter>
    </>
  );
}
