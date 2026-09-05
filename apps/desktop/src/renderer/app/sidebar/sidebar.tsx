import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInput,
} from "@repo/ui/components/sidebar";
import { cn } from "@repo/ui/lib/utils";
import { isVaultMetadataPath } from "@repo/notes/knowledge/doc-file";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import {
  ArchiveRestoreIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronsDownUpIcon,
  FilePlusIcon,
  FolderIcon,
  FolderPlusIcon,
  FolderTreeIcon,
  SettingsIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { platformShortcutModifier } from "../global-shortcuts";
import {
  readSidebarFolder,
  readSidebarView,
  writeSidebarFolder,
  writeSidebarView,
  type SidebarView,
} from "../prefs";
import { hasInsetTitleBar } from "../title-bar";
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

function FolderPicker({
  vaultName,
  folders,
  value,
  onChange,
}: {
  vaultName: string;
  folders: readonly string[];
  value: string;
  onChange: (folder: string) => void;
}) {
  const label = value === "" ? vaultName : basenamePath(value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Folder"
        className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 text-sm font-medium outline-none hover:bg-hover"
      >
        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onClick={() => {
            onChange("");
          }}
        >
          <CheckIcon className={cn("size-3.5", value !== "" && "invisible")} />
          {vaultName}
        </DropdownMenuItem>
        {folders.map((folder) => (
          <DropdownMenuItem
            key={folder}
            onClick={() => {
              onChange(folder);
            }}
          >
            <CheckIcon className={cn("size-3.5", value !== folder && "invisible")} />
            <span
              className="min-w-0 truncate"
              style={{ paddingLeft: folder.split("/").length * 12 - 12 }}
            >
              {basenamePath(folder)}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
  const [view, setView] = useState<SidebarView>(readSidebarView);
  const [folder, setFolder] = useState<string>(readSidebarFolder);
  const [pendingCreate, setPendingCreate] = useState<{
    kind: "file" | "dir";
    parentDir: string;
  } | null>(null);
  const [treeCreateDir, setTreeCreateDir] = useState("");
  const [collapseAllNonce, setCollapseAllNonce] = useState(0);
  const [insetTitleBar] = useState(hasInsetTitleBar);
  const modifier = platformShortcutModifier();

  const entries = treeQuery.data?.entries ?? EMPTY_ENTRIES;
  const folders = useMemo(
    () =>
      entries
        .filter((entry) => entry.kind === "dir" && !isVaultMetadataPath(entry.path))
        .map((entry) => entry.path),
    [entries],
  );
  // a remembered folder the vault no longer holds shows the root, once the listing has answered
  const scope = treeQuery.data !== undefined && !folders.includes(folder) ? "" : folder;
  const scoped = useMemo(() => entriesUnder(entries, scope), [entries, scope]);

  const showTree = view === "tree";
  const chooseView = (next: SidebarView): void => {
    writeSidebarView(next);
    setView(next);
  };
  // A create lands where an IDE's would: in the tree's selected folder. The recents view
  // selects nothing, so it lands at the scope.
  const startCreate = (kind: "file" | "dir"): void => {
    chooseView("tree");
    setPendingCreate({ kind, parentDir: showTree ? treeCreateDir : scope });
  };

  // The search input opens the palette on pointerup, never on click or
  // pointerdown: a dialog mounted mid-gesture reads the release as an outside
  // press and dismisses itself. preventDefault keeps focus off the field.
  return (
    <>
      <SidebarHeader className="gap-2">
        {insetTitleBar ? (
          <div aria-hidden="true" className="h-5 shrink-0 [-webkit-app-region:drag]" />
        ) : null}
        <div className="flex items-center gap-0.5">
          <FolderPicker
            vaultName={treeQuery.data?.name ?? "Vault"}
            folders={folders}
            value={scope}
            onChange={(next) => {
              writeSidebarFolder(next);
              setFolder(next);
            }}
          />
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label="New note"
            title="New note"
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
            title="New folder"
            onClick={() => {
              startCreate("dir");
            }}
          >
            <FolderPlusIcon />
          </Button>
          {showTree ? (
            <Button
              variant="ghost"
              size="icon-compact"
              aria-label="Collapse all"
              title="Collapse all"
              onClick={() => {
                setCollapseAllNonce((nonce) => nonce + 1);
              }}
            >
              <ChevronsDownUpIcon />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label={showTree ? "Show recent notes" : "Show file tree"}
            title={showTree ? "Show recent notes" : "Show file tree"}
            aria-pressed={showTree}
            onClick={() => {
              chooseView(showTree ? "recents" : "tree");
            }}
          >
            <FolderTreeIcon className={cn(showTree && "text-foreground")} />
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
      </SidebarHeader>
      <SidebarContent>
        {showTree ? (
          <FileTree
            entries={scoped}
            loadState={treeLoadState(treeQuery)}
            onRetry={() => void treeQuery.refetch()}
            openPath={openPath}
            onOpenFile={onOpenFile}
            ops={ops}
            pendingCreate={pendingCreate}
            onPendingCreateHandled={() => setPendingCreate(null)}
            rootDir={scope}
            onCreateDirChange={setTreeCreateDir}
            collapseAllNonce={collapseAllNonce}
          />
        ) : (
          <NotesList entries={scoped} scope={scope} openPath={openPath} onOpenFile={onOpenFile} />
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
