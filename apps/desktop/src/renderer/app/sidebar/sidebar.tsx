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
  ArchiveRestoreIcon,
  FilePlusIcon,
  FolderPlusIcon,
  FolderTreeIcon,
  SettingsIcon,
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
  const title = status.lastError ?? syncBlockedReason(status) ?? "Sync now";
  return (
    <button
      type="button"
      disabled={!canSync}
      title={title}
      onClick={onSyncNow}
      className={cn(
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
  onOpenDeletedNotes: () => void;
  onOpenSearch: () => void;
}

export function SidebarRailContent({
  openPath,
  onOpenFile,
  ops,
  onSyncNow,
  onOpenSettings,
  onOpenDeletedNotes,
  onOpenSearch,
}: SidebarRailContentProps) {
  const treeQuery = useVaultTree();
  const [pendingCreate, setPendingCreate] = useState<{
    kind: "file" | "dir";
    parentDir: string;
  } | null>(null);
  const [showTree, setShowTree] = useState(false);
  const modifier = platformShortcutModifier();

  // The search input opens the palette on pointerup, never on click or
  // pointerdown: a dialog mounted mid-gesture reads the release as an outside
  // press and dismisses itself. preventDefault keeps focus off the field.
  return (
    <>
      <SidebarHeader className="gap-2">
        <div className="flex items-center gap-1">
          <h2 className="min-w-0 flex-1 truncate px-1 text-sm font-medium">
            {treeQuery.data?.name ?? "Vault"}
          </h2>
          <Button
            variant="ghost"
            size="icon-compact"
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
            size="icon-compact"
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
        <div className="relative">
          <SidebarInput
            readOnly
            placeholder="Search…"
            aria-label="Search notes"
            onFocus={(event) => {
              event.currentTarget.blur();
              onOpenSearch();
            }}
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
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label="Deleted notes"
            onClick={onOpenDeletedNotes}
          >
            <ArchiveRestoreIcon className="size-4 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label="Settings"
            onClick={onOpenSettings}
          >
            <SettingsIcon className="size-4 text-muted-foreground" />
          </Button>
        </div>
      </SidebarFooter>
    </>
  );
}
