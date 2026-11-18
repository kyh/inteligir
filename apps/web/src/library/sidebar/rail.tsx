// CLAUDE.md § The rail chooses the library's scope. Stacked groups over the one grid (the library,
// its folders, its tags, Deleted), each row a link to a scope with the count the cell answers for
// it, and Settings at its foot.

import type { LibraryScope } from "@repo/contract/library-scope";
import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
} from "@repo/ui/components/sidebar-core";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/components/sidebar-menu";
import { Tooltip } from "@repo/ui/components/tooltip";
import { formatCount } from "@repo/ui/lib/plural";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  EllipsisIcon,
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
import type { ComponentProps, MouseEvent } from "react";

import { useLibraryQueries } from "../cloud/library-context";
import { libraryHref, scopeAddress } from "../library-address";
import { useLibraryCommands } from "../library/library-commands";
import { usePref, windowLayout } from "../prefs";
import { folderPaths } from "./folder-paths";
import type { FolderRow } from "./folder-paths";

export interface RailProps {
  readonly scope: LibraryScope;
  // an item is open over the grid, so no scope row is lit
  readonly itemOpen: boolean;
}

const Count = ({ count }: { count: number }) => (
  <SidebarMenuBadge>{formatCount(count)}</SidebarMenuBadge>
);

const isLit = (scope: LibraryScope, itemOpen: boolean, row: LibraryScope): boolean => {
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

// a click the browser opens elsewhere, in a new tab or window, is left to the browser
const opensElsewhere = (event: MouseEvent): boolean =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

type ScopeLinkProps = RailProps &
  Omit<ComponentProps<typeof SidebarMenuButton>, "isActive" | "onClick" | "render"> & {
    readonly target: LibraryScope;
  };

// A row is a link to its scope, so it has an address to copy and a modified or middle click opens
// it in a new tab; a plain click moves this tab, so the leave guard asks once and Back walks scopes.
const ScopeLink = ({ target, scope, itemOpen, ...props }: ScopeLinkProps) => {
  const commands = useLibraryCommands();
  return (
    <SidebarMenuButton
      {...props}
      isActive={isLit(scope, itemOpen, target)}
      render={(link) => (
        <a {...link} href={libraryHref(scopeAddress(target))}>
          {link.children}
        </a>
      )}
      onClick={(event) => {
        if (opensElsewhere(event)) {
          return;
        }
        event.preventDefault();
        commands.showScope(target);
      }}
    />
  );
};

// the menu drops under More when More opened it, and under the row when a right-click on it did
type FolderMenu = { readonly under: "more" } | { readonly under: "row"; readonly row: HTMLElement };

const FolderItem = ({
  row,
  count,
  scope,
  itemOpen,
}: RailProps & { readonly row: FolderRow; readonly count: number }) => {
  const commands = useLibraryCommands();
  const [menu, setMenu] = useState<FolderMenu | null>(null);
  return (
    <SidebarMenuItem>
      <ScopeLink
        target={{ folderId: row.id, kind: "folder" }}
        scope={scope}
        itemOpen={itemOpen}
        icon={FolderIcon}
        style={{ paddingLeft: `${String(8 + row.depth * 12)}px` }}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ row: event.currentTarget, under: "row" });
        }}
      >
        {row.name}
        <Count count={count} />
      </ScopeLink>
      <DropdownMenu
        open={menu !== null}
        onOpenChange={(open) => {
          setMenu(open ? { under: "more" } : null);
        }}
      >
        <DropdownMenuTrigger render={<SidebarMenuAction aria-label={`More for ${row.name}`} />}>
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          anchor={menu?.under === "row" ? menu.row : undefined}
          side="bottom"
          align="start"
        >
          <DropdownMenuItem
            onClick={() => {
              commands.newFolder(row.id);
            }}
          >
            New folder inside…
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              commands.renameFolder(row.id, row.name);
            }}
          >
            Rename…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              commands.deleteFolder(row.id, row.name);
            }}
          >
            Delete folder…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
};

const FolderRows = ({ scope, itemOpen }: RailProps) => {
  const folders = useQuery(useLibraryQueries().scopes()).data?.folders ?? [];
  const counts = new Map(folders.map((folder) => [folder.id, folder.items]));
  return (
    <SidebarMenu aria-label="Folders">
      {folderPaths(folders).map((row) => (
        <FolderItem
          key={row.id}
          row={row}
          count={counts.get(row.id) ?? 0}
          scope={scope}
          itemOpen={itemOpen}
        />
      ))}
    </SidebarMenu>
  );
};

const TagRows = ({ scope, itemOpen }: RailProps) => {
  const tags = useQuery(useLibraryQueries().scopes()).data?.tags ?? [];
  if (tags.length === 0) {
    return <p className="m-0 px-3 py-1 text-caption text-muted-foreground">No tags yet</p>;
  }
  return (
    <SidebarMenu aria-label="Tags">
      {tags.map(({ items, tag }) => (
        <SidebarMenuItem key={tag}>
          <ScopeLink
            target={{ kind: "tag", tag }}
            scope={scope}
            itemOpen={itemOpen}
            icon={HashIcon}
          >
            {tag}
            <Count count={items} />
          </ScopeLink>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
};

export const Rail = ({ scope, itemOpen }: RailProps) => {
  const commands = useLibraryCommands();
  const scopes = useQuery(useLibraryQueries().scopes()).data;
  const [tagsOpen, setTagsOpen] = usePref(windowLayout, "railTagsOpen");
  return (
    <>
      <SidebarHeader>
        <div className="flex items-center gap-1 pr-1.5">
          <p className="m-0 min-w-0 flex-1 truncate px-2 text-subtitle font-medium">Library</p>
          <Button
            variant="ghost"
            size="icon-compact"
            className="size-6 shrink-0"
            aria-label="Search"
            onClick={() => {
              commands.openPalette();
            }}
          >
            <SearchIcon />
          </Button>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Library</SidebarGroupLabel>
          <SidebarMenu aria-label="Library">
            <SidebarMenuItem>
              <ScopeLink
                target={{ kind: "all" }}
                scope={scope}
                itemOpen={itemOpen}
                icon={LibraryIcon}
              >
                All items
                <Count count={scopes?.total ?? 0} />
              </ScopeLink>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <ScopeLink
                target={{ kind: "unsorted" }}
                scope={scope}
                itemOpen={itemOpen}
                icon={InboxIcon}
              >
                Unsorted
                <Count count={scopes?.unsorted ?? 0} />
              </ScopeLink>
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
                  commands.newFolder(null);
                }}
              >
                <FolderPlusIcon />
              </SidebarGroupAction>
            </Tooltip>
          </SidebarGroupActions>
          <FolderRows scope={scope} itemOpen={itemOpen} />
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
          {tagsOpen ? <TagRows scope={scope} itemOpen={itemOpen} /> : null}
        </SidebarGroup>
        <SidebarGroup>
          <SidebarMenu aria-label="Deleted">
            <SidebarMenuItem>
              <ScopeLink
                target={{ kind: "deleted" }}
                scope={scope}
                itemOpen={itemOpen}
                icon={Trash2Icon}
              >
                Deleted
              </ScopeLink>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center justify-end gap-1 pr-1.5">
          <Button
            variant="ghost"
            size="icon-compact"
            className="size-6 shrink-0"
            aria-label="Settings"
            onClick={() => {
              commands.openSettings();
            }}
          >
            <SettingsIcon />
          </Button>
        </div>
      </SidebarFooter>
    </>
  );
};
