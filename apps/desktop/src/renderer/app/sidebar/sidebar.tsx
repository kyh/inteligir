import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { SidebarContent, SidebarHeader, SidebarSearchField } from "@repo/ui/components/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { cn } from "cn";
import { isVaultMetadataPath } from "@repo/notes/knowledge/doc-file";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  FilePlusIcon,
  FolderIcon,
  FolderOpenIcon,
  SearchIcon,
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
import { RAIL_VIEWS, readTreeSort, writeTreeSort } from "../prefs";
import type { RailView, TreeSort } from "../prefs";
import { hasInsetTitleBar } from "../title-bar";
import { usePinnedPaths, useVaultTree, vaultFolders } from "../vault-hooks";
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

// the workspace row: the name at the rows' text size, semibold, the chevron beside it
const VAULT_TRIGGER_CLASS =
  "flex h-7 max-w-full min-w-0 items-center gap-1 rounded-md px-1.5 text-[13px] font-semibold outline-none";

// the rows the Recent section shows; the palette lists every note
const RECENT_LIMIT = 8;

// The vault is the server's: switching it restarts the child and replaces this window, and the
// folder is picked in main, so this is a menu over what main remembers. A browser tab has no
// bridge and did not start the server, so it gets the name alone.
const VaultButton = ({ vaultName }: { vaultName: string }) => {
  const vaults = useDesktopVaults();
  const { busy, run } = useVaultSwitch((message) => {
    toast.error(message);
  });
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
  );
};

// the breadcrumb sets the scope; this is where it is seen and cleared
const FolderScopeHeader = ({ folder, onClear }: { folder: string; onClear: () => void }) => (
  <div className="flex items-center gap-1 py-1">
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
}: SidebarRailContentProps) => {
  const treeQuery = useVaultTree();
  const pinnedPaths = usePinnedPaths();
  const tree = useTreeState();
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [treeSort, setTreeSort] = useState<TreeSort>(readTreeSort);
  // not persisted: a search is a question about now
  const [query, setQuery] = useState("");
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
    switch (view) {
      case "recent": {
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
              filter={query}
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
            filter={query}
          />
        );
      }
      case "files": {
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
            filter={query}
            vaultRoot={treeQuery.data?.root ?? null}
          />
        );
      }
      default: {
        return null;
      }
    }
  };

  // One column: the vault, the search field and the view switch stack in the header on the
  // rows' rhythm, and the chosen list takes the rest. Every other verb is a right-click.
  return (
    <>
      <SidebarHeader className="gap-1">
        {insetTitleBar ? (
          <div aria-hidden="true" className="h-5 shrink-0 [-webkit-app-region:drag]" />
        ) : null}
        <div className="flex items-center gap-1">
          <VaultButton vaultName={treeQuery.data?.name ?? "Vault"} />
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label="New note"
            className="ml-auto shrink-0"
            onClick={startCreate}
          >
            <FilePlusIcon />
          </Button>
        </div>
        <SidebarSearchField
          icon={SearchIcon}
          value={query}
          placeholder="Search…"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setQuery("");
              event.currentTarget.blur();
            }
          }}
        />
        <Tabs
          value={view}
          onValueChange={(value) => {
            const next = RAIL_VIEWS.find((name) => name === value);
            if (next !== undefined) {
              onViewChange(next);
            }
          }}
        >
          <TabsList aria-label="Rail views" className="h-7">
            {RAIL_VIEWS.map((name) => (
              <TabsTrigger key={name} value={name} className="text-xs">
                {RAIL_VIEW_LABELS[name]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </SidebarHeader>
      <SidebarContent className="px-2">
        {scope === "" ? null : (
          <FolderScopeHeader
            folder={scope}
            onClear={() => {
              onFolderChange("");
            }}
          />
        )}
        {list()}
      </SidebarContent>
    </>
  );
};
