// CLAUDE.md § THE RAIL CHOOSES THE LIBRARY'S SCOPE, AMBIENT STATE LIVES IN ITS FOOTER. Stacked
// groups over the one grid (the library, its folders, its tags, Deleted), each row a scope read
// from the replica, and a footer saying where the library stands: up to date, sending, or waiting
// for a connection.

import type { CellLibraryScope } from "@repo/domain/library-scope";
import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@repo/ui/components/sidebar-menu";
import { Tooltip } from "@repo/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  FolderIcon,
  FolderPlusIcon,
  HashIcon,
  InboxIcon,
  LibraryIcon,
  SearchIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

import { useReplicaQueries } from "../cloud/library-context";
import { formatCount } from "../library/item-labels";
import { PREFS, usePref } from "../prefs";
import { folderPaths } from "./folder-paths";
import { SyncLine } from "./sync-line";

interface FolderActions {
  readonly create: (parentId: string | null) => void;
  readonly rename: (folderId: string, name: string) => void;
  readonly remove: (folderId: string, name: string) => void;
}

export interface RailProps {
  readonly scope: CellLibraryScope;
  // an item is open over the grid, so no scope row is lit
  readonly itemOpen: boolean;
  readonly onScope: (scope: CellLibraryScope) => void;
  readonly folders: FolderActions;
  readonly onOpenSearch: () => void;
  readonly onOpenSettings: () => void;
}

const Count = ({ count }: { count: number }) => (
  <span className="ml-auto shrink-0 text-caption text-muted-foreground tabular-nums">
    {formatCount(count)}
  </span>
);

const isLit = (scope: CellLibraryScope, itemOpen: boolean, row: CellLibraryScope): boolean => {
  if (itemOpen || scope.kind !== row.kind) {
    return false;
  }
  if (scope.kind === "folder" && row.kind === "folder") {
    return scope.folderId === row.folderId;
  }
  if (scope.kind === "tag" && row.kind === "tag") {
    return scope.tag === row.tag;
  }
  return true;
};

interface FolderMenu {
  readonly anchor: HTMLElement;
  readonly id: string;
  readonly name: string;
}

const FolderRows = ({
  scope,
  itemOpen,
  onScope,
  actions,
}: {
  scope: CellLibraryScope;
  itemOpen: boolean;
  onScope: (scope: CellLibraryScope) => void;
  actions: FolderActions;
}) => {
  const queries = useReplicaQueries();
  const folders = useQuery(queries.folders()).data ?? [];
  const counts = useQuery(queries.scopes()).data?.folders ?? [];
  const [menu, setMenu] = useState<FolderMenu | null>(null);
  const countOf = (id: string): number => counts.find((folder) => folder.id === id)?.items ?? 0;
  return (
    <>
      <SidebarMenu aria-label="Folders">
        {folderPaths(folders).map((row) => {
          const target: CellLibraryScope = { folderId: row.id, kind: "folder" };
          return (
            <SidebarMenuItem key={row.id}>
              <SidebarMenuButton
                icon={FolderIcon}
                isActive={isLit(scope, itemOpen, target)}
                style={{ paddingLeft: `${String(8 + row.depth * 12)}px` }}
                data-folder-id={row.id}
                onClick={() => {
                  onScope(target);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ anchor: event.currentTarget, id: row.id, name: row.name });
                }}
              >
                {row.name}
                <Count count={countOf(row.id)} />
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
      <DropdownMenu
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMenu(null);
          }
        }}
      >
        {menu === null ? null : (
          <DropdownMenuContent anchor={menu.anchor} side="bottom" align="start">
            <DropdownMenuItem
              onClick={() => {
                setMenu(null);
                actions.create(menu.id);
              }}
            >
              New folder inside…
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setMenu(null);
                actions.rename(menu.id, menu.name);
              }}
            >
              Rename…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                setMenu(null);
                actions.remove(menu.id, menu.name);
              }}
            >
              Delete folder…
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>
    </>
  );
};

const TagRows = ({
  scope,
  itemOpen,
  onScope,
}: {
  scope: CellLibraryScope;
  itemOpen: boolean;
  onScope: (scope: CellLibraryScope) => void;
}) => {
  const tags = useQuery(useReplicaQueries().tags()).data ?? [];
  if (tags.length === 0) {
    return <p className="m-0 px-3 py-1 text-caption text-muted-foreground">No tags yet</p>;
  }
  return (
    <SidebarMenu aria-label="Tags">
      {tags.map(({ items, tag }) => {
        const target: CellLibraryScope = { kind: "tag", tag };
        return (
          <SidebarMenuItem key={tag}>
            <SidebarMenuButton
              icon={HashIcon}
              isActive={isLit(scope, itemOpen, target)}
              onClick={() => {
                onScope(target);
              }}
            >
              {tag}
              <Count count={items} />
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
};

export const Rail = ({
  scope,
  itemOpen,
  onScope,
  folders,
  onOpenSearch,
  onOpenSettings,
}: RailProps) => {
  const scopes = useQuery(useReplicaQueries().scopes()).data;
  const [tagsOpen, setTagsOpen] = usePref(PREFS.railTagsOpen);
  const all: CellLibraryScope = { kind: "all" };
  const unsorted: CellLibraryScope = { kind: "unsorted" };
  const deleted: CellLibraryScope = { kind: "deleted" };
  return (
    <>
      <SidebarHeader>
        <div className="flex items-center gap-1 pr-1.5">
          <p className="m-0 min-w-0 flex-1 truncate px-2 text-subtitle font-medium">Library</p>
          <Tooltip content="Search" side="bottom">
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
          <SidebarMenu aria-label="Library">
            <SidebarMenuItem>
              <SidebarMenuButton
                icon={LibraryIcon}
                isActive={isLit(scope, itemOpen, all)}
                onClick={() => {
                  onScope(all);
                }}
              >
                All items
                <Count count={scopes?.total ?? 0} />
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                icon={InboxIcon}
                isActive={isLit(scope, itemOpen, unsorted)}
                onClick={() => {
                  onScope(unsorted);
                }}
              >
                Unsorted
                <Count count={scopes?.unsorted ?? 0} />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Folders</SidebarGroupLabel>
          <SidebarGroupActions>
            <Tooltip content="New folder" side="top">
              <SidebarGroupAction
                aria-label="New folder"
                onClick={() => {
                  folders.create(null);
                }}
              >
                <FolderPlusIcon />
              </SidebarGroupAction>
            </Tooltip>
          </SidebarGroupActions>
          <FolderRows scope={scope} itemOpen={itemOpen} onScope={onScope} actions={folders} />
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
          {tagsOpen ? <TagRows scope={scope} itemOpen={itemOpen} onScope={onScope} /> : null}
        </SidebarGroup>
        <SidebarGroup>
          <SidebarMenu aria-label="Deleted">
            <SidebarMenuItem>
              <SidebarMenuButton
                icon={Trash2Icon}
                isActive={isLit(scope, itemOpen, deleted)}
                onClick={() => {
                  onScope(deleted);
                }}
              >
                Deleted
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-1 pr-1.5">
          <SyncLine />
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
        </div>
      </SidebarFooter>
    </>
  );
};
