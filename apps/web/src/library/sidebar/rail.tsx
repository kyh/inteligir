import type { LibraryScope } from "@repo/contract/library-scope";
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
  ChevronDown as ChevronDownIcon,
  FilterLines as FilterIcon,
  FolderPlus as FolderPlusIcon,
  Hash01 as HashIcon,
  Inbox01 as InboxIcon,
  LayersThree01 as LibraryIcon,
  SearchMd as SearchIcon,
  Settings01 as SettingsIcon,
  Trash01 as Trash2Icon,
  XClose as XIcon,
} from "@untitledui/icons";
import { ListPlusIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { useLibraryQueries } from "../cloud/library-context";
import { isViewAt, libraryHref, scopeAddress, viewAddress } from "../library-address";
import { useLibraryAddress } from "../library-history";
import { useLibraryCommands } from "../library/library-commands";
import { usePref, windowLayout } from "../prefs";
import { LibraryTree, opensElsewhere } from "./library-tree";

export interface RailProps {
  readonly scope: LibraryScope;
  readonly openItem: string | null;
}

const Count = ({ count }: { count: number }) => (
  <SidebarMenuBadge>{formatCount(count)}</SidebarMenuBadge>
);

const isLit = (scope: LibraryScope, openItem: string | null, row: LibraryScope) => {
  if (openItem !== null || scope.kind !== row.kind) {
    return false;
  }

  if (scope.kind === "parent" && row.kind === "parent") {
    return scope.parentId === row.parentId;
  }

  if (scope.kind === "tag" && row.kind === "tag") {
    return scope.tag === row.tag;
  }

  return true;
};

type ScopeLinkProps = RailProps &
  Omit<ComponentProps<typeof SidebarMenuButton>, "isActive" | "onClick" | "render"> & {
    readonly target: LibraryScope;
  };

const ScopeLink = ({ target, scope, openItem, ...props }: ScopeLinkProps) => {
  const commands = useLibraryCommands();
  const { words } = useLibraryAddress();

  return (
    <SidebarMenuButton
      {...props}
      isActive={words === null && isLit(scope, openItem, target)}
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

const TagRows = ({ scope, openItem }: RailProps) => {
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
            openItem={openItem}
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

const ViewRows = () => {
  const commands = useLibraryCommands();
  const address = useLibraryAddress();
  const views = useQuery(useLibraryQueries().scopes()).data?.views ?? [];

  if (views.length === 0) {
    return null;
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Views</SidebarGroupLabel>
      <SidebarMenu aria-label="Views">
        {views.map((view) => (
          <SidebarMenuItem key={view.id}>
            <SidebarMenuButton
              icon={FilterIcon}
              isActive={isViewAt(view, address)}
              render={(link) => (
                <a {...link} href={libraryHref(viewAddress(view))}>
                  {link.children}
                </a>
              )}
              onClick={(event) => {
                if (opensElsewhere(event)) {
                  return;
                }

                event.preventDefault();
                commands.showView(view);
              }}
            >
              {view.name}
            </SidebarMenuButton>
            <SidebarMenuAction
              aria-label={`Delete the view ${view.name}`}
              onClick={() => {
                commands.removeView(view.id);
              }}
            >
              <XIcon />
            </SidebarMenuAction>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
};

export const Rail = ({ scope, openItem }: RailProps) => {
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
                openItem={openItem}
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
                openItem={openItem}
                icon={InboxIcon}
              >
                Unsorted
                <Count count={scopes?.unsorted ?? 0} />
              </ScopeLink>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <ViewRows />
        <SidebarGroup>
          <SidebarGroupLabel>Folders</SidebarGroupLabel>
          <SidebarGroupActions>
            <Tooltip content="New list" side="top">
              <SidebarGroupAction
                aria-label="New list"
                onClick={() => {
                  commands.newList(null);
                }}
              >
                <ListPlusIcon />
              </SidebarGroupAction>
            </Tooltip>
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
          <LibraryTree scope={scope} openItem={openItem} />
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
          {tagsOpen ? <TagRows scope={scope} openItem={openItem} /> : null}
        </SidebarGroup>
        <SidebarGroup>
          <SidebarMenu aria-label="Deleted">
            <SidebarMenuItem>
              <ScopeLink
                target={{ kind: "deleted" }}
                scope={scope}
                openItem={openItem}
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
