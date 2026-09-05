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
import { renamedTag } from "@repo/notes/knowledge/rename-tags";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import {
  ArchiveRestoreIcon,
  ArrowDownAZIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronsDownUpIcon,
  ClockArrowDownIcon,
  FilePlusIcon,
  FolderIcon,
  FolderPlusIcon,
  FolderTreeIcon,
  SettingsIcon,
  TagIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bindingFor, platformShortcutModifier } from "../global-shortcuts";
import {
  readSidebarView,
  readTreeSort,
  writeSidebarView,
  writeTreeSort,
  type SidebarView,
  type TreeSort,
} from "../prefs";
import { hasInsetTitleBar } from "../title-bar";
import {
  canSyncNow,
  syncBlockedReason,
  syncStateDotClass,
  syncStateLabel,
  useNotesWithTag,
  usePinnedPaths,
  useTags,
  useVaultStatus,
  useVaultTree,
} from "../vault-hooks";
import { FileTree, type TreeLoadState, type TreeOps } from "./file-tree";
import { NotesList } from "./notes-list";
import { RenameTagDialog, TagScopeHeader, TagsView } from "./tags-view";

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
  onMoveRequest: (path: string) => void;
  // a `#tag` chip's ask: show that tag's notes; handled once the rail is on it
  tagRequest: string | null;
  onTagRequestHandled: () => void;
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
  onOpenSearch,
  onMoveRequest,
  tagRequest,
  onTagRequestHandled,
  folder,
  onFolderChange,
}: SidebarRailContentProps) {
  const treeQuery = useVaultTree();
  const pinnedPaths = usePinnedPaths();
  const [view, setView] = useState<SidebarView>(readSidebarView);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState<{
    kind: "file" | "dir";
    parentDir: string;
  } | null>(null);
  const [treeCreateDir, setTreeCreateDir] = useState("");
  const [collapseAllNonce, setCollapseAllNonce] = useState(0);
  const [treeSort, setTreeSort] = useState<TreeSort>(readTreeSort);
  // not persisted: a filter is a question about now
  const [treeFilter, setTreeFilter] = useState("");
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
  const showTags = view === "tags";
  const chooseView = (next: SidebarView): void => {
    writeSidebarView(next);
    setView(next);
  };

  // Adopted during render so the first paint is already on the tag; the handback
  // stays an effect because it clears the store the chip wrote.
  const [adoptedTagRequest, setAdoptedTagRequest] = useState<string | null>(null);
  if (adoptedTagRequest !== tagRequest) {
    setAdoptedTagRequest(tagRequest);
    if (tagRequest !== null) {
      chooseView("tags");
      setSelectedTag(tagRequest);
    }
  }
  useEffect(() => {
    if (tagRequest !== null) onTagRequestHandled();
  }, [tagRequest, onTagRequestHandled]);

  const tagsQuery = useTags(showTags);
  const taggedQuery = useNotesWithTag(showTags ? selectedTag : null);
  const taggedPaths = useMemo(
    () => new Set((taggedQuery.data?.results ?? []).map((result) => result.path)),
    [taggedQuery.data],
  );
  const taggedEntries = useMemo(
    () => scoped.filter((entry) => entry.kind === "file" && taggedPaths.has(entry.path)),
    [scoped, taggedPaths],
  );
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
            onChange={onFolderChange}
          />
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
          {showTree ? (
            <Button
              variant="ghost"
              size="icon-compact"
              aria-label="Collapse all"
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
            aria-pressed={showTree}
            onClick={() => {
              chooseView(showTree ? "recents" : "tree");
            }}
          >
            <FolderTreeIcon className={cn(showTree && "text-foreground")} />
          </Button>
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label={showTags ? "Show recent notes" : "Show tags"}
            title={showTags ? "Show recent notes" : "Show tags"}
            aria-pressed={showTags}
            onClick={() => {
              chooseView(showTags ? "recents" : "tags");
            }}
          >
            <TagIcon className={cn(showTags && "text-foreground")} />
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
            {bindingFor("open-palette", modifier)}
          </kbd>
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
          </div>
        ) : null}
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
            onMoveRequest={onMoveRequest}
            pinnedPaths={pinnedPaths}
            sort={treeSort}
            filter={treeFilter}
            {...(treeQuery.data === undefined ? {} : { vaultRoot: treeQuery.data.root })}
          />
        ) : showTags && selectedTag === null ? (
          <TagsView
            tags={tagsQuery.data?.tags ?? []}
            loaded={tagsQuery.data !== undefined}
            onSelect={setSelectedTag}
            onRename={setRenamingTag}
          />
        ) : showTags && selectedTag !== null ? (
          <>
            <TagScopeHeader
              tag={selectedTag}
              count={taggedQuery.data === undefined ? undefined : taggedEntries.length}
              onClear={() => {
                setSelectedTag(null);
              }}
              onRename={() => {
                setRenamingTag(selectedTag);
              }}
            />
            <NotesList
              entries={taggedEntries}
              scope={scope}
              openPath={openPath}
              onOpenFile={onOpenFile}
              emptyText={
                taggedQuery.data === undefined ? "…" : `No notes tagged #${selectedTag} here.`
              }
              onSetPinned={ops.setPinned}
            />
          </>
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
      <RenameTagDialog
        tag={renamingTag}
        onOpenChange={(open) => {
          if (!open) setRenamingTag(null);
        }}
        onRenamed={(from, to) => {
          setSelectedTag((current) =>
            current === null ? null : (renamedTag(current, from, to) ?? current),
          );
        }}
      />
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
