import { Button } from "@repo/ui/components/button";
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
import type { LibraryScope } from "@repo/domain/library-scope";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  FolderPlusIcon,
  MoonIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react";
import { useState } from "react";
import { orpc } from "../api";
import { useLibraryScopes } from "../library/library-items";
import type { CapturePayload } from "../library/capture/capture-payload";
import { PREFS, usePref } from "../prefs";
import type { SettingsSection } from "../settings/settings-page";
import { hasInsetTitleBar } from "../title-bar";
import { useVaultTree } from "../vault-hooks";
import { FolderTree } from "./folder-tree";
import { RailReadFailed } from "./rail-read-failed";
import { DeletedRow, ScopeRows } from "./scope-rows";
import { SyncRow } from "./sync-row";
import { TagList } from "./tag-list";
import type { TreeOps } from "./tree-ops";
import { VaultRow } from "./vault-row";

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
  // the scope the library shows, lit in the rail while no item is open over it
  scope: LibraryScope;
  itemOpen: boolean;
  onScope: (scope: LibraryScope) => void;
  ops: TreeOps;
  onMoveRequest: (paths: readonly [string, ...string[]]) => void;
  onNewNoteIn: (folder: string) => void;
  onSaveInto: (payload: CapturePayload, folder: string) => void;
  onRenameTag: (tag: string) => void;
  onTidy?: (() => void) | undefined;
  onOpenSearch: () => void;
  searchShortcut: string | null;
  onSyncNow: () => void;
  onOpenSettings: (section?: SettingsSection) => void;
}

// which row the rail lights: the scope the library shows, and none while an item is open over it
const litRows = (scope: LibraryScope, itemOpen: boolean) => {
  const active = itemOpen ? null : scope;
  return {
    deleted: active?.kind === "deleted",
    folder: active?.kind === "folder" ? active.path : null,
    scope: active?.kind === "all" || active?.kind === "unsorted" ? active.kind : null,
    tag: active?.kind === "tag" ? active.tag : null,
  };
};

// CLAUDE.md § THE RAIL CHOOSES THE LIBRARY'S SCOPE: stacked groups, each a set of scopes over the
// one grid, and the footer the window's ambient state.
export const SidebarRailContent = ({
  scope,
  itemOpen,
  onScope,
  ops,
  onMoveRequest,
  onNewNoteIn,
  onSaveInto,
  onRenameTag,
  onTidy,
  onOpenSearch,
  searchShortcut,
  onSyncNow,
  onOpenSettings,
}: SidebarRailContentProps) => {
  const treeQuery = useVaultTree();
  const scopesQuery = useLibraryScopes();
  const tagsQuery = useQuery(orpc.knowledge.tags.queryOptions());
  const [tagsOpen, setTagsOpen] = usePref(PREFS.railTagsOpen);
  // the group's "New folder" asks the tree for a name input at the root, once per press
  const [createFolder, setCreateFolder] = useState(0);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [insetTitleBar] = useState(hasInsetTitleBar);
  const lit = litRows(scope, itemOpen);
  const scopes = scopesQuery.data;

  return (
    <>
      <SidebarHeader>
        {insetTitleBar ? <TitleBarDragStrip /> : null}
        <div className="flex items-center gap-1 pr-1.5">
          <div className="min-w-0 flex-1">
            <VaultRow vaultName={treeQuery.data?.name ?? "Library"} />
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
          <SidebarGroupLabel>Library</SidebarGroupLabel>
          <ScopeRows
            active={lit.scope}
            total={scopes === undefined ? null : scopes.total}
            unsorted={scopes === undefined ? null : scopes.unsorted}
            onScope={onScope}
            onTidy={onTidy}
          />
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Folders</SidebarGroupLabel>
          <SidebarGroupActions>
            <Tooltip content="New folder" side="top">
              <SidebarGroupAction
                aria-label="New folder"
                onClick={() => {
                  setCreateFolder((count) => count + 1);
                }}
              >
                <FolderPlusIcon />
              </SidebarGroupAction>
            </Tooltip>
          </SidebarGroupActions>
          {scopesQuery.isLoadingError ? (
            <RailReadFailed
              sentence="The library could not be read."
              onRetry={() => {
                void scopesQuery.refetch();
              }}
            />
          ) : (
            <FolderTree
              folders={scopes === undefined ? [] : scopes.folders}
              activeFolder={lit.folder}
              onScope={onScope}
              ops={ops}
              onMoveRequest={onMoveRequest}
              onNewNoteIn={onNewNoteIn}
              onSaveInto={onSaveInto}
              createAtRoot={createFolder}
            />
          )}
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel
            aria-expanded={tagsOpen}
            onClick={() => {
              setTagsOpen(!tagsOpen);
            }}
          >
            Tags
            <ChevronDownIcon
              size={12}
              strokeWidth={1.5}
              className={tagsOpen ? "shrink-0" : "shrink-0 -rotate-90"}
            />
          </SidebarGroupLabel>
          {tagsOpen ? (
            <TagList
              tags={tagsQuery.data?.tags ?? []}
              activeTag={lit.tag}
              onTag={(tag) => {
                onScope({ kind: "tag", tag });
              }}
              onRenameTag={onRenameTag}
            />
          ) : null}
        </SidebarGroup>
        <SidebarGroup>
          <DeletedRow active={lit.deleted} onScope={onScope} />
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
