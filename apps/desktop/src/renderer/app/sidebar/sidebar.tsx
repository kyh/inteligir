import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInput,
} from "@repo/ui/components/sidebar";
import { TabsSubtle, TabsSubtleItem } from "@repo/ui/components/tabs-subtle";
import { cn } from "cn";
import { isVaultMetadataPath } from "@repo/notes/knowledge/doc-file";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import {
  ArchiveRestoreIcon,
  ArrowDownAZIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronsDownUpIcon,
  ClockArrowDownIcon,
  FilePlusIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  SettingsIcon,
  VaultIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "@repo/ui/components/sonner";
import {
  openRecentVault,
  pickVault,
  RecentVaultLabel,
  useDesktopVaults,
  useVaultSwitch,
} from "../desktop-vaults";
import { readTreeSort, writeTreeSort, type SidebarView, type TreeSort } from "../prefs";
import { hasInsetTitleBar } from "../title-bar";
import {
  canSyncNow,
  syncBlockedReason,
  syncStateDotClass,
  syncStateLabel,
  usePinnedPaths,
  useVaultStatus,
  useVaultTree,
  vaultFolders,
} from "../vault-hooks";
import { FileTree, type PendingCreate, type TreeLoadState, type TreeOps } from "./file-tree";
import { NotesList } from "./notes-list";
import { TagsPane } from "./tags-pane";
import { createDirFor, useTreeState } from "./tree-state";

const EMPTY_ENTRIES: readonly VaultEntry[] = [];

// "" is the vault root. The folder itself is not a row: its children are.
export function entriesUnder(entries: readonly VaultEntry[], folder: string): VaultEntry[] {
  return entries.filter(
    (entry) =>
      !isVaultMetadataPath(entry.path) && (folder === "" || entry.path.startsWith(`${folder}/`)),
  );
}

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

const VAULT_TRIGGER_CLASS =
  "flex h-7 max-w-full min-w-0 items-center gap-1 rounded-md px-1.5 text-sm font-medium outline-none";

// the switch's order; the pref stores the name, never the index
const SIDEBAR_VIEWS: readonly SidebarView[] = ["recents", "tree", "tags"];
const SIDEBAR_VIEW_LABELS = {
  recents: "Recent",
  tree: "Files",
  tags: "Tags",
} satisfies Record<SidebarView, string>;

// The vault is the server's: switching it restarts the child and replaces this window, and the
// folder is picked in main, so this is a menu over what main remembers. A browser tab has no
// bridge and did not start the server, so it gets the name alone.
function VaultButton({ vaultName }: { vaultName: string }) {
  const vaults = useDesktopVaults();
  const { busy, run } = useVaultSwitch(toast.error);
  // no icon: the row is the name's, and a long vault name is the whole point of the row; the
  // chevron sits beside the name, not at the rail's edge, so it reads as one control
  const label = <span className="min-w-0 truncate">{vaultName}</span>;
  if (vaults.kind !== "state") {
    return <span className={VAULT_TRIGGER_CLASS}>{label}</span>;
  }
  const { state } = vaults;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Vault"
        disabled={busy !== null}
        className={cn(VAULT_TRIGGER_CLASS, "hover:bg-hover disabled:opacity-50")}
      >
        {label}
        <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {state.recent.map((vault) => (
          <DropdownMenuItem
            key={vault.path}
            className="h-auto py-1.5"
            onClick={() => {
              run("opening", () => openRecentVault(vault.path));
            }}
          >
            <VaultIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <RecentVaultLabel vault={vault} />
          </DropdownMenuItem>
        ))}
        {state.recent.length > 0 ? <DropdownMenuSeparator /> : null}
        {state.blocked === null ? (
          <DropdownMenuItem
            onClick={() => {
              run("picking", pickVault);
            }}
          >
            <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
            Open another vault…
          </DropdownMenuItem>
        ) : (
          <DropdownMenuLabel className="max-w-64 whitespace-normal">
            {state.blocked}
          </DropdownMenuLabel>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// the breadcrumb sets the scope; this is where it is seen and cleared
function FolderScopeHeader({ folder, onClear }: { folder: string; onClear: () => void }) {
  return (
    <div className="flex items-center gap-1 px-1.5 py-1">
      <Button variant="ghost" size="icon-compact" aria-label="Whole vault" onClick={onClear}>
        <ArrowLeftIcon />
      </Button>
      <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={folder}>
        {folder}
      </span>
    </div>
  );
}

export interface SidebarRailContentProps {
  openPath: string | null;
  onOpenFile: (path: string) => void;
  ops: TreeOps;
  onSyncNow: () => void;
  onOpenSettings: () => void;
  onOpenDeletedNotes: () => void;
  onMoveRequest: (path: string) => void;
  // the view and the tag are the workspace's: a `#tag` chip in the note sets both
  view: SidebarView;
  onViewChange: (view: SidebarView) => void;
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
  // the listing's folder ("" is the vault): owned by the workspace, since the top bar's
  // breadcrumb sets it too
  folder: string;
  onFolderChange: (folder: string) => void;
}

export function SidebarRailContent({
  openPath,
  onOpenFile,
  ops,
  onSyncNow,
  onOpenSettings,
  onOpenDeletedNotes,
  onMoveRequest,
  view,
  onViewChange,
  selectedTag,
  onSelectTag,
  folder,
  onFolderChange,
}: SidebarRailContentProps) {
  const treeQuery = useVaultTree();
  const pinnedPaths = usePinnedPaths();
  const tree = useTreeState();
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [treeSort, setTreeSort] = useState<TreeSort>(readTreeSort);
  // not persisted: a filter is a question about now
  const [treeFilter, setTreeFilter] = useState("");
  const [insetTitleBar] = useState(hasInsetTitleBar);

  const entries = treeQuery.data?.entries ?? EMPTY_ENTRIES;
  const folders = useMemo(() => new Set(vaultFolders(entries)), [entries]);
  // a remembered folder the vault no longer holds shows the root, once the listing has answered
  const scope = treeQuery.data !== undefined && !folders.has(folder) ? "" : folder;
  const scoped = useMemo(() => entriesUnder(entries, scope), [entries, scope]);

  const showTree = view === "tree";
  // A create lands where an IDE's would: in the tree's selected folder. The recents view
  // selects nothing, so it lands at the scope.
  const startCreate = (kind: "file" | "dir"): void => {
    onViewChange("tree");
    const parentDir = showTree
      ? createDirFor(scope, tree.activePath, (path) => folders.has(path))
      : scope;
    setPendingCreate({ kind, parentDir });
  };

  return (
    <>
      <SidebarHeader className="gap-2">
        {insetTitleBar ? (
          <div aria-hidden="true" className="h-5 shrink-0 [-webkit-app-region:drag]" />
        ) : null}
        <VaultButton vaultName={treeQuery.data?.name ?? "Vault"} />
        <div className="flex items-center justify-between gap-1">
          <TabsSubtle
            aria-label="Sidebar view"
            size="compact"
            selectedIndex={SIDEBAR_VIEWS.indexOf(view)}
            onSelect={(index) => {
              const next = SIDEBAR_VIEWS[index];
              if (next !== undefined) onViewChange(next);
            }}
          >
            {SIDEBAR_VIEWS.map((name, index) => (
              <TabsSubtleItem key={name} index={index} label={SIDEBAR_VIEW_LABELS[name]} />
            ))}
          </TabsSubtle>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-compact"
              aria-label="New note"
              onClick={() => {
                startCreate("file");
              }}
            >
              <FilePlusIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-compact"
              aria-label="New folder"
              onClick={() => {
                startCreate("dir");
              }}
            >
              <FolderPlusIcon />
            </Button>
          </div>
        </div>
        {showTree ? (
          <div className="flex items-center gap-0.5">
            <SidebarInput
              value={treeFilter}
              placeholder="Filter files…"
              aria-label="Filter files"
              onChange={(event) => {
                setTreeFilter(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setTreeFilter("");
                  event.currentTarget.blur();
                }
              }}
            />
            <Button
              variant="ghost"
              size="icon-compact"
              aria-label={treeSort === "name" ? "Sort by modified" : "Sort by name"}
              onClick={() => {
                const next: TreeSort = treeSort === "name" ? "modified" : "name";
                writeTreeSort(next);
                setTreeSort(next);
              }}
            >
              {treeSort === "name" ? <ArrowDownAZIcon /> : <ClockArrowDownIcon />}
            </Button>
            <Button
              variant="ghost"
              size="icon-compact"
              aria-label="Collapse all"
              onClick={tree.collapseAll}
            >
              <ChevronsDownUpIcon />
            </Button>
          </div>
        ) : null}
      </SidebarHeader>
      <SidebarContent>
        {scope === "" ? null : (
          <FolderScopeHeader
            folder={scope}
            onClear={() => {
              onFolderChange("");
            }}
          />
        )}
        {showTree ? (
          <FileTree
            entries={scoped}
            loadState={treeLoadState(treeQuery)}
            onRetry={() => void treeQuery.refetch()}
            openPath={openPath}
            onOpenFile={onOpenFile}
            ops={ops}
            state={tree}
            pendingCreate={pendingCreate}
            onPendingCreateDone={() => setPendingCreate(null)}
            rootDir={scope}
            onMoveRequest={onMoveRequest}
            pinnedPaths={pinnedPaths}
            sort={treeSort}
            filter={treeFilter}
            vaultRoot={treeQuery.data?.root ?? null}
          />
        ) : view === "tags" ? (
          <TagsPane
            entries={scoped}
            scope={scope}
            openPath={openPath}
            onOpenFile={onOpenFile}
            onSetPinned={ops.setPinned}
            selectedTag={selectedTag}
            onSelectTag={onSelectTag}
          />
        ) : (
          <NotesList
            entries={scoped}
            scope={scope}
            openPath={openPath}
            onOpenFile={onOpenFile}
            onSetPinned={ops.setPinned}
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
