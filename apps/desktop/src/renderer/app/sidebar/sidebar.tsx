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
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupActions,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/components/sidebar";
import { Spinner } from "@repo/ui/components/spinner";
import { Tooltip } from "@repo/ui/components/tooltip";
import { useTheme } from "@repo/ui/lib/theme";
import { cn } from "cn";
import { isVaultMetadataPath } from "@repo/notes/knowledge/doc-file";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import {
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  FolderIcon,
  FolderOpenIcon,
  MoonIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  VaultIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "@repo/ui/components/sonner";
import { useThreads } from "../actions/thread-hooks";
import {
  openRecentVault,
  pickVault,
  RecentVaultLabel,
  useDesktopVaults,
  useVaultSwitch,
} from "../desktop-vaults";
import { readTreeSort, writeTreeSort } from "../prefs";
import type { RailView, TreeSort } from "../prefs";
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
import { FileTree } from "./file-tree";
import type { PendingCreate, TreeLoadState, TreeOps } from "./file-tree";
import { NotesList } from "./notes-list";
import { TaggedNotes } from "./tagged-notes";
import { createDirFor, useTreeState } from "./tree-state";

const EMPTY_ENTRIES: readonly VaultEntry[] = [];

// "" is the vault root. The folder itself is not a row: its children are.
export const entriesUnder = (entries: readonly VaultEntry[], folder: string): VaultEntry[] =>
  entries.filter(
    (entry) =>
      !isVaultMetadataPath(entry.path) && (folder === "" || entry.path.startsWith(`${folder}/`)),
  );

const treeLoadState = (query: ReturnType<typeof useVaultTree>): TreeLoadState => {
  if (query.isError) {
    return "failed";
  }
  return query.data === undefined ? "loading" : "loaded";
};

// the rows the Recent view shows; the palette lists every note
const RECENT_LIMIT = 8;

// the tooltip's label with its chord beside it, on the tooltip's own height
const tipWithShortcut = (label: string, shortcut: string | null) =>
  shortcut === null ? (
    label
  ) : (
    <span className="flex items-center gap-2">
      <span>{label}</span>
      <kbd className="-my-1 flex h-4 min-w-4 items-center justify-center rounded border border-background/30 px-1 font-sans text-[10px] text-background/80">
        {shortcut}
      </kbd>
    </span>
  );

// the vault's mark: its initial on a 20px tile, centred on the rows' leading icon axis
const VaultTile = ({ name }: { name: string }) => (
  <span
    aria-hidden="true"
    className="pointer-events-none absolute top-1/2 left-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-md bg-foreground text-[10px] font-semibold text-background"
  >
    {name.slice(0, 1).toLocaleUpperCase()}
  </span>
);

// The vault is the server's: switching it restarts the child and replaces this window, and the
// folder is picked in main, so this is a menu over what main remembers. A browser tab has no
// bridge and did not start the server, so it gets the name alone.
const VaultRow = ({ vaultName }: { vaultName: string }) => {
  const vaults = useDesktopVaults();
  const { busy, run } = useVaultSwitch((message) => {
    toast.error(message);
  });
  const label = (
    <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">{vaultName}</span>
  );
  if (vaults.kind !== "state") {
    return (
      <div className="relative flex h-7 items-center pr-2 pl-8">
        <VaultTile name={vaultName} />
        {label}
      </div>
    );
  }
  const { state } = vaults;
  return (
    <SidebarMenu aria-label="Vault" className="@container">
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={busy !== null}
            render={
              <SidebarMenuButton aria-label="Switch vault" className="pl-8 disabled:opacity-50">
                <VaultTile name={vaultName} />
                {label}
                <span className="ml-auto inline-flex @max-[7rem]:hidden">
                  <ChevronDownIcon size={16} strokeWidth={1.5} className="text-muted-foreground" />
                </span>
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent align="start" sideOffset={4}>
            {state.recent.map((vault) => (
              <DropdownMenuItem
                key={vault.path}
                className="h-auto py-1.5"
                onClick={() => {
                  run("opening", async () => {
                    await openRecentVault(vault.path);
                  });
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
      </SidebarMenuItem>
    </SidebarMenu>
  );
};

// the breadcrumb sets the scope; this is where it is seen and cleared
const FolderScopeHeader = ({ folder, onClear }: { folder: string; onClear: () => void }) => (
  <div className="flex items-center gap-1 px-2 pt-2">
    <Button variant="ghost" size="icon-compact" aria-label="Whole vault" onClick={onClear}>
      <ArrowLeftIcon />
    </Button>
    <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
    <span className="min-w-0 flex-1 truncate text-sm font-medium" title={folder}>
      {folder}
    </span>
  </div>
);

const RAIL_VIEW_LABELS: Record<RailView, string> = {
  files: "Files",
  recent: "Recent",
};

const otherView = (view: RailView): RailView => (view === "files" ? "recent" : "files");

// The rail's ambient row: the sync state as the row, its verbs behind it, and the agent's
// spinner while a thread runs. Settings and the theme sit beside it as the footer's actions.
const SyncRow = ({
  onSyncNow,
  onOpenDeletedNotes,
  onOpenSettings,
}: {
  onSyncNow: () => void;
  onOpenDeletedNotes: () => void;
  onOpenSettings: () => void;
}) => {
  const statusQuery = useVaultStatus();
  const threadsQuery = useThreads();
  const agentWorking = (threadsQuery.data?.threads ?? []).some(
    (thread) =>
      thread.status === "active" || thread.status === "starting" || thread.status === "stopping",
  );
  const status = statusQuery.data;
  const canSync = canSyncNow(status);
  const blocked = status === undefined ? null : (status.lastError ?? syncBlockedReason(status));
  return (
    <SidebarMenu aria-label="Sync" className="min-w-0 flex-1">
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton aria-label="Sync and vault menu">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    status === undefined ? "bg-muted-foreground/40" : syncStateDotClass(status),
                  )}
                />
                {status === undefined ? "…" : syncStateLabel(status)}
                {agentWorking ? (
                  <Spinner className="ml-1 size-3 shrink-0 text-muted-foreground" />
                ) : null}
                <span className="ml-auto -mr-0.5 flex size-6 shrink-0 items-center justify-center">
                  <ChevronsUpDownIcon
                    size={16}
                    strokeWidth={1.5}
                    className="text-muted-foreground"
                  />
                </span>
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent side="top" align="start" sideOffset={6}>
            {blocked === null ? null : (
              <DropdownMenuLabel className="max-w-64 whitespace-normal">
                {blocked}
              </DropdownMenuLabel>
            )}
            <DropdownMenuItem disabled={!canSync} onClick={onSyncNow}>
              <RefreshCwIcon />
              Sync now
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenDeletedNotes}>
              <ArchiveRestoreIcon />
              Deleted notes…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenSettings}>
              <SettingsIcon />
              Settings…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};

const ThemeButton = () => {
  const { resolved, setTheme } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <Tooltip content={next === "dark" ? "Dark theme" : "Light theme"} side="top">
      <Button
        variant="ghost"
        size="icon-compact"
        className="size-6 shrink-0"
        aria-label={next === "dark" ? "Switch to dark theme" : "Switch to light theme"}
        onClick={() => {
          setTheme(next);
        }}
      >
        {resolved === "dark" ? <SunIcon /> : <MoonIcon />}
      </Button>
    </Tooltip>
  );
};

export interface SidebarRailContentProps {
  openPath: string | null;
  onOpenFile: (path: string) => void;
  ops: TreeOps;
  onMoveRequest: (path: string) => void;
  // the view and the tag: the workspace's, since a `#tag` chip in the note shows Recent scoped
  // to the tag, and a create shows Files
  view: RailView;
  onViewChange: (view: RailView) => void;
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
  // the listing's folder ("" is the vault): owned by the workspace, since the top bar's
  // breadcrumb sets it too
  folder: string;
  onFolderChange: (folder: string) => void;
  // the header's search is the quick switcher; the chord is spelled by the workspace's table
  onOpenSearch: () => void;
  searchShortcut: string | null;
  onSyncNow: () => void;
  onOpenDeletedNotes: () => void;
  onOpenSettings: () => void;
}

export const SidebarRailContent = ({
  openPath,
  onOpenFile,
  ops,
  onMoveRequest,
  view,
  onViewChange,
  selectedTag,
  onSelectTag,
  folder,
  onFolderChange,
  onOpenSearch,
  searchShortcut,
  onSyncNow,
  onOpenDeletedNotes,
  onOpenSettings,
}: SidebarRailContentProps) => {
  const treeQuery = useVaultTree();
  const pinnedPaths = usePinnedPaths();
  const tree = useTreeState();
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [treeSort, setTreeSort] = useState<TreeSort>(readTreeSort);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [insetTitleBar] = useState(hasInsetTitleBar);
  const handleSetPinned = ops.setPinned;

  const entries = treeQuery.data?.entries ?? EMPTY_ENTRIES;
  const folders = useMemo(() => new Set(vaultFolders(entries)), [entries]);
  // a remembered folder the vault no longer holds shows the root, once the listing has answered
  const scope = treeQuery.data !== undefined && !folders.has(folder) ? "" : folder;
  const scoped = useMemo(() => entriesUnder(entries, scope), [entries, scope]);

  // The header's one create is a note; a folder is the tree's right-click. It lands where an
  // IDE's would: in the tree's selected folder, else at the scope.
  const startCreate = (): void => {
    onViewChange("files");
    setPendingCreate({
      kind: "file",
      parentDir: createDirFor(scope, tree.activePath, (path) => folders.has(path)),
    });
  };
  const changeSort = (next: TreeSort): void => {
    writeTreeSort(next);
    setTreeSort(next);
  };

  const list = (): React.ReactNode => {
    if (view === "recent") {
      if (selectedTag !== null) {
        return (
          <TaggedNotes
            key={selectedTag}
            tag={selectedTag}
            onSelectTag={onSelectTag}
            entries={scoped}
            scope={scope}
            openPath={openPath}
            onOpenFile={onOpenFile}
            onSetPinned={handleSetPinned}
          />
        );
      }
      return (
        <NotesList
          entries={scoped}
          scope={scope}
          openPath={openPath}
          onOpenFile={onOpenFile}
          onSetPinned={handleSetPinned}
          limit={RECENT_LIMIT}
        />
      );
    }
    return (
      <FileTree
        entries={scoped}
        loadState={treeLoadState(treeQuery)}
        onRetry={() => {
          void treeQuery.refetch();
        }}
        openPath={openPath}
        onOpenFile={onOpenFile}
        ops={ops}
        state={tree}
        pendingCreate={pendingCreate}
        onPendingCreateDone={() => {
          setPendingCreate(null);
        }}
        rootDir={scope}
        onMoveRequest={onMoveRequest}
        pinnedPaths={pinnedPaths}
        sort={treeSort}
        onSortChange={changeSort}
        vaultRoot={treeQuery.data?.root ?? null}
      />
    );
  };

  // Fluid's sidebar anatomy: the vault row and Search share the header line; one group whose
  // label is the view's name and its switch, with New note as the group's action; the sync row,
  // Settings and the theme in the footer. Every other verb is a right-click.
  return (
    <>
      <SidebarHeader>
        {insetTitleBar ? (
          <div aria-hidden="true" className="h-5 shrink-0 [-webkit-app-region:drag]" />
        ) : null}
        <div className="flex items-center gap-1 pr-1.5">
          <div className="min-w-0 flex-1">
            <VaultRow vaultName={treeQuery.data?.name ?? "Vault"} />
          </div>
          <Tooltip content={tipWithShortcut("Search", searchShortcut)} side="bottom">
            <Button
              variant="ghost"
              size="icon-compact"
              className="size-6 shrink-0"
              aria-label="Search"
              onClick={onOpenSearch}
            >
              <SearchIcon />
            </Button>
          </Tooltip>
        </div>
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
        <SidebarGroup>
          <Tooltip content={`Show ${RAIL_VIEW_LABELS[otherView(view)]}`} side="top">
            <SidebarGroupLabel
              aria-label={`${RAIL_VIEW_LABELS[view]}: show ${RAIL_VIEW_LABELS[otherView(view)]}`}
              onClick={() => {
                onViewChange(otherView(view));
              }}
            >
              {RAIL_VIEW_LABELS[view]}
            </SidebarGroupLabel>
          </Tooltip>
          <SidebarGroupActions>
            <Tooltip content="New note" side="top">
              <SidebarGroupAction aria-label="New note" onClick={startCreate}>
                <PlusIcon />
              </SidebarGroupAction>
            </Tooltip>
          </SidebarGroupActions>
          {list()}
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-1 pr-1.5">
          <SyncRow
            onSyncNow={onSyncNow}
            onOpenDeletedNotes={onOpenDeletedNotes}
            onOpenSettings={onOpenSettings}
          />
          <Tooltip content="Settings" side="top">
            <Button
              variant="ghost"
              size="icon-compact"
              className="size-6 shrink-0"
              aria-label="Settings"
              onClick={onOpenSettings}
            >
              <SettingsIcon />
            </Button>
          </Tooltip>
          <ThemeButton />
        </div>
      </SidebarFooter>
    </>
  );
};
