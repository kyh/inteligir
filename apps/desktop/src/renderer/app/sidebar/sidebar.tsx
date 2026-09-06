import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { SidebarHeader, SidebarInput } from "@repo/ui/components/sidebar";
import { cn } from "@repo/ui/lib/utils";
import { isVaultMetadataPath } from "@repo/notes/knowledge/doc-file";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import {
  ArrowDownAZIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronsDownUpIcon,
  ClockArrowDownIcon,
  FilePlusIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  ListFilterIcon,
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
import { FoldSection } from "../fold-section";
import {
  readTreeSort,
  writeTreeSort,
  type RailSection,
  type RailSections,
  type TreeSort,
} from "../prefs";
import { hasInsetTitleBar } from "../title-bar";
import { usePinnedPaths, useVaultTree, vaultFolders } from "../vault-hooks";
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

const VAULT_TRIGGER_CLASS =
  "flex h-chrome-row max-w-full min-w-0 items-center gap-1 rounded-md px-1.5 text-sm font-medium outline-none";

// the rows the Recent section shows; the palette lists every note
const RECENT_LIMIT = 8;

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
  onMoveRequest: (path: string) => void;
  // which sections are unfolded, and the tag: the workspace's, since a `#tag` chip in the note
  // opens Tags and selects, and a create opens Files
  sections: RailSections;
  onSectionOpenChange: (section: RailSection, open: boolean) => void;
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
  onMoveRequest,
  sections,
  onSectionOpenChange,
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [insetTitleBar] = useState(hasInsetTitleBar);

  const entries = treeQuery.data?.entries ?? EMPTY_ENTRIES;
  const folders = useMemo(() => new Set(vaultFolders(entries)), [entries]);
  // a remembered folder the vault no longer holds shows the root, once the listing has answered
  const scope = treeQuery.data !== undefined && !folders.has(folder) ? "" : folder;
  const scoped = useMemo(() => entriesUnder(entries, scope), [entries, scope]);

  // A create lands where an IDE's would: in the tree's selected folder, else at the scope.
  const startCreate = (kind: "file" | "dir"): void => {
    onSectionOpenChange("files", true);
    setPendingCreate({
      kind,
      parentDir: createDirFor(scope, tree.activePath, (path) => folders.has(path)),
    });
  };
  const closeFilter = (): void => {
    setTreeFilter("");
    setFilterOpen(false);
  };

  const filesActions = (
    <>
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
      <Button
        variant="ghost"
        size="icon-compact"
        aria-label={filterOpen ? "Hide filter" : "Show filter"}
        aria-pressed={filterOpen}
        onClick={() => {
          if (filterOpen) {
            closeFilter();
          } else {
            onSectionOpenChange("files", true);
            setFilterOpen(true);
          }
        }}
      >
        <ListFilterIcon />
      </Button>
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
    </>
  );

  // The sections' host is a plain column, not SidebarContent: its ScrollArea gives the column no
  // height, and each section scrolls on its own.
  return (
    <>
      <SidebarHeader>
        {insetTitleBar ? (
          <div aria-hidden="true" className="h-5 shrink-0 [-webkit-app-region:drag]" />
        ) : null}
        <VaultButton vaultName={treeQuery.data?.name ?? "Vault"} />
      </SidebarHeader>
      <div className="flex min-h-0 w-full flex-1 flex-col">
        {scope === "" ? null : (
          <FolderScopeHeader
            folder={scope}
            onClear={() => {
              onFolderChange("");
            }}
          />
        )}
        <FoldSection
          label="Recent"
          open={sections.recent}
          onOpenChange={(open) => {
            onSectionOpenChange("recent", open);
          }}
        >
          <NotesList
            entries={scoped}
            scope={scope}
            openPath={openPath}
            onOpenFile={onOpenFile}
            onSetPinned={ops.setPinned}
            limit={RECENT_LIMIT}
          />
        </FoldSection>
        <FoldSection
          label="Files"
          fill
          actions={filesActions}
          open={sections.files}
          onOpenChange={(open) => {
            onSectionOpenChange("files", open);
          }}
        >
          {filterOpen ? (
            <div className="shrink-0 px-1 pb-1">
              <SidebarInput
                autoFocus
                value={treeFilter}
                placeholder="Filter files…"
                aria-label="Filter files"
                onChange={(event) => {
                  setTreeFilter(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeFilter();
                  }
                }}
              />
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
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
          </div>
        </FoldSection>
        <FoldSection
          label="Tags"
          fill
          open={sections.tags}
          onOpenChange={(open) => {
            onSectionOpenChange("tags", open);
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TagsPane
              entries={scoped}
              scope={scope}
              openPath={openPath}
              onOpenFile={onOpenFile}
              onSetPinned={ops.setPinned}
              selectedTag={selectedTag}
              onSelectTag={onSelectTag}
            />
          </div>
        </FoldSection>
      </div>
    </>
  );
}
