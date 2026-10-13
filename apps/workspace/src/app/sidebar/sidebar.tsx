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
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupActions,
  SidebarGroupLabel,
  SidebarHeader,
} from "@repo/ui/components/sidebar-core";
import { Tooltip } from "@repo/ui/components/tooltip";
import { useTheme } from "@repo/ui/lib/theme";
import type { VaultEntry } from "@repo/contract/local/vault/vault-schema";
import {
  ChevronDownIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react";
import { useState } from "react";
import { PREFS, RAIL_VIEWS, usePref } from "../prefs";
import type { RailView } from "../prefs";
import type { SettingsSection } from "../settings/settings-page";
import { hasInsetTitleBar } from "../title-bar";
import { usePinnedPaths, useVaultTree, visibleEntries } from "../vault-hooks";
import { DeletedNotes } from "./deleted-notes";
import { FileTree } from "./file-tree";
import type { TreeLoadState, TreeOps } from "./file-tree";
import { NotesList } from "./notes-list";
import { SyncRow } from "./sync-row";
import { TaggedNotes } from "./tagged-notes";
import { useTreeState } from "./tree-state";
import type { TreeReveal } from "./tree-state";
import { VaultRow } from "./vault-row";

const EMPTY_ENTRIES: readonly VaultEntry[] = [];

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
      <kbd className="-my-1 flex h-4 min-w-4 items-center justify-center rounded border border-background/30 px-1 font-sans text-caption text-background/80">
        {shortcut}
      </kbd>
    </span>
  );

const RAIL_VIEW_LABELS: Record<RailView, string> = {
  deleted: "Deleted",
  files: "Files",
  recent: "Recent",
};

// The shell drags the window only on a mousedown whose target is this element itself, so it
// stays a childless strip: a child would take the press and drag nothing.
const TitleBarDragStrip = () => (
  <div aria-hidden="true" className="h-5 shrink-0" data-tauri-drag-region />
);

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
  // the breadcrumb's ask; the tree says once it has focused the row, so the owner can clear it
  reveal: TreeReveal | null;
  onRevealConsumed: () => void;
  onOpenSearch: () => void;
  searchShortcut: string | null;
  onSyncNow: () => void;
  onOpenSettings: (section?: SettingsSection) => void;
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
  reveal,
  onRevealConsumed,
  onOpenSearch,
  searchShortcut,
  onSyncNow,
  onOpenSettings,
}: SidebarRailContentProps) => {
  const treeQuery = useVaultTree();
  const pinnedPaths = usePinnedPaths();
  const [treeSort, changeSort] = usePref(PREFS.treeSort);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [insetTitleBar] = useState(hasInsetTitleBar);
  const handleSetPinned = ops.setPinned;

  const entries = treeQuery.data?.entries ?? EMPTY_ENTRIES;
  const listed = visibleEntries(entries);
  // the breadcrumb's reveal and the open note land on the fold state the rail owns, during the
  // rail's own render; the tree focuses the revealed row its next render draws
  const tree = useTreeState({ entries: listed, onRevealConsumed, openPath, reveal });

  // The group's create is a note; a folder is the tree's right-click.
  const startCreate = (): void => {
    onViewChange("files");
    tree.startCreateInSelection("file");
  };

  const list = (): React.ReactNode => {
    switch (view) {
      case "deleted": {
        return <DeletedNotes onOpenNote={onOpenFile} />;
      }
      case "recent": {
        if (selectedTag !== null) {
          return (
            <TaggedNotes
              key={selectedTag}
              tag={selectedTag}
              onSelectTag={onSelectTag}
              entries={listed}
              openPath={openPath}
              onOpenFile={onOpenFile}
              onSetPinned={handleSetPinned}
            />
          );
        }
        return (
          <NotesList
            entries={listed}
            openPath={openPath}
            onOpenFile={onOpenFile}
            onSetPinned={handleSetPinned}
            limit={RECENT_LIMIT}
          />
        );
      }
      case "files": {
        return (
          <FileTree
            entries={listed}
            loadState={treeLoadState(treeQuery)}
            onRetry={() => {
              void treeQuery.refetch();
            }}
            openPath={openPath}
            onOpenFile={onOpenFile}
            ops={ops}
            state={tree}
            onMoveRequest={onMoveRequest}
            pinnedPaths={pinnedPaths}
            sort={treeSort}
            onSortChange={changeSort}
            vaultRoot={treeQuery.data?.root ?? null}
          />
        );
      }
      default: {
        const exhaustive: never = view;
        return exhaustive;
      }
    }
  };

  return (
    <>
      <SidebarHeader>
        {insetTitleBar ? <TitleBarDragStrip /> : null}
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
        <SidebarGroup>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarGroupLabel aria-label={`View: ${RAIL_VIEW_LABELS[view]}`}>
                  {RAIL_VIEW_LABELS[view]}
                  <ChevronDownIcon size={12} strokeWidth={1.5} className="shrink-0" />
                </SidebarGroupLabel>
              }
            />
            <DropdownMenuContent align="start" sideOffset={2}>
              {RAIL_VIEWS.map((name) => (
                <DropdownMenuItem
                  key={name}
                  onClick={() => {
                    onViewChange(name);
                  }}
                >
                  {RAIL_VIEW_LABELS[name]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
            onOpenSyncDetails={() => {
              onOpenSettings("advanced");
            }}
          />
          <Tooltip content="Settings" side="top">
            <Button
              variant="ghost"
              size="icon-compact"
              className="size-6 shrink-0"
              aria-label="Settings"
              onClick={() => {
                onOpenSettings();
              }}
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
