import type { LibraryScope } from "@repo/contract/library-scope";
import { compareTreeNodes } from "@repo/contract/library/item-tree";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/components/sidebar-menu";
import { cn } from "@repo/ui/lib/cn";
import { formatCount } from "@repo/ui/lib/plural";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRightIcon,
  EllipsisIcon,
  FileTextIcon,
  FolderIcon,
  InboxIcon,
  ListIcon,
} from "lucide-react";
import { useState } from "react";
import type { ComponentProps, MouseEvent, ReactNode } from "react";

import { useLibraryQueries } from "../cloud/library-context";
import { libraryHref, scopeAddress } from "../library-address";
import { useLibraryCommands } from "../library/library-commands";
import { usePref, windowLayout } from "../prefs";
import type { ContainerNode } from "./folder-paths";

const INDENT_PX = 12;
const ROW_START_PX = 22;

const indentOf = (depth: number) => ({
  paddingLeft: `${String(ROW_START_PX + depth * INDENT_PX)}px`,
});

export const opensElsewhere = (event: MouseEvent) =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

interface Counted extends ContainerNode {
  readonly items: number;
}

const childrenOf = (containers: readonly Counted[]) => {
  const ids = new Set(containers.map(({ id }) => id));
  const children = new Map<string | null, Counted[]>();

  for (const container of containers) {
    const parent =
      container.parentId !== null && ids.has(container.parentId) ? container.parentId : null;

    children.set(parent, [...(children.get(parent) ?? []), container]);
  }

  for (const [parent, held] of children) {
    children.set(parent, held.toSorted(compareTreeNodes));
  }

  return children;
};

interface TreeState {
  readonly scope: LibraryScope;
  readonly openItem: string | null;
  readonly isOpen: (id: string, kind: "folder" | "note") => boolean;
  readonly toggle: (id: string, kind: "folder" | "note") => void;
}

const Chevron = ({
  depth,
  open,
  title,
  onToggle,
}: {
  readonly depth: number;
  readonly open: boolean;
  readonly title: string;
  readonly onToggle: () => void;
}) => (
  <button
    type="button"
    tabIndex={-1}
    aria-expanded={open}
    aria-label={`${open ? "Close" : "Open"} ${title}`}
    className="absolute top-1/2 z-20 flex size-4 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground"
    style={{ left: `${String(4 + depth * INDENT_PX)}px` }}
    onClick={(event) => {
      event.stopPropagation();
      onToggle();
    }}
  >
    <ChevronRightIcon
      size={12}
      strokeWidth={1.5}
      className={cn("transition-transform duration-80", open ? "rotate-90" : "")}
    />
  </button>
);

type MenuAt = { readonly under: "more" } | { readonly under: "row"; readonly row: HTMLElement };

type ScopeRowProps = Omit<ComponentProps<typeof SidebarMenuButton>, "onClick" | "render"> & {
  readonly target: LibraryScope;
};

const ScopeRow = ({ target, ...props }: ScopeRowProps) => {
  const commands = useLibraryCommands();

  return (
    <SidebarMenuButton
      {...props}
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

const ContainerRow = ({
  node,
  depth,
  tree,
}: {
  readonly node: Counted;
  readonly depth: number;
  readonly tree: TreeState;
}) => {
  const commands = useLibraryCommands();
  const [menu, setMenu] = useState<MenuAt | null>(null);

  const lit =
    tree.openItem === null && tree.scope.kind === "parent" && tree.scope.parentId === node.id;

  const open = node.kind === "folder" && tree.isOpen(node.id, "folder");

  return (
    <SidebarMenuItem>
      {node.kind === "folder" ? (
        <Chevron
          depth={depth}
          open={open}
          title={node.title}
          onToggle={() => {
            tree.toggle(node.id, "folder");
          }}
        />
      ) : null}
      <ScopeRow
        target={{ kind: "parent", parentId: node.id }}
        isActive={lit}
        icon={node.kind === "list" ? ListIcon : FolderIcon}
        style={indentOf(depth)}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ row: event.currentTarget, under: "row" });
        }}
      >
        {node.title}
        <SidebarMenuBadge>{formatCount(node.items)}</SidebarMenuBadge>
      </ScopeRow>
      <DropdownMenu
        open={menu !== null}
        onOpenChange={(next) => {
          setMenu(next ? { under: "more" } : null);
        }}
      >
        <DropdownMenuTrigger render={<SidebarMenuAction aria-label={`More for ${node.title}`} />}>
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          anchor={menu?.under === "row" ? menu.row : undefined}
          side="bottom"
          align="start"
        >
          {node.kind === "folder" ? (
            <>
              <DropdownMenuItem
                onClick={() => {
                  commands.newNoteIn(node.id);
                }}
              >
                New note inside
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  commands.newFolder(node.id);
                }}
              >
                New folder inside…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  commands.newList(node.id);
                }}
              >
                New list inside…
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuItem
            onClick={() => {
              commands.renameFolder(node.id, node.title, node.kind);
            }}
          >
            Rename…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              commands.deleteFolder(node.id, node.title, node.kind);
            }}
          >
            {node.kind === "list" ? "Delete list…" : "Delete folder…"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
};

const NoteRows = ({
  parentId,
  depth,
  tree,
}: {
  readonly parentId: string | null;
  readonly depth: number;
  readonly tree: TreeState;
}) => {
  const commands = useLibraryCommands();
  const answer = useQuery(useLibraryQueries().children(parentId)).data;

  if (answer === undefined) {
    return null;
  }

  return (
    <>
      {answer.children.map((note) => {
        const title = note.title === "" ? "Untitled" : note.title;
        const open = note.hasChildren && tree.isOpen(note.id, "note");

        return (
          <NoteRow
            key={note.id}
            id={note.id}
            title={title}
            depth={depth}
            tree={tree}
            chevron={
              note.hasChildren ? (
                <Chevron
                  depth={depth}
                  open={open}
                  title={title}
                  onToggle={() => {
                    tree.toggle(note.id, "note");
                  }}
                />
              ) : null
            }
            below={open ? <NoteRows parentId={note.id} depth={depth + 1} tree={tree} /> : null}
          />
        );
      })}
      {parentId === null && answer.more ? (
        <SidebarMenuItem>
          <ScopeRow target={{ kind: "unsorted" }} icon={InboxIcon} style={indentOf(depth)}>
            More in Unsorted
          </ScopeRow>
        </SidebarMenuItem>
      ) : null}
      {parentId !== null && answer.more ? (
        <SidebarMenuItem>
          <SidebarMenuButton
            style={indentOf(depth)}
            onClick={() => {
              commands.showScope({ kind: "parent", parentId });
            }}
          >
            More…
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : null}
    </>
  );
};

const NoteRow = ({
  id,
  title,
  depth,
  tree,
  chevron,
  below,
}: {
  readonly id: string;
  readonly title: string;
  readonly depth: number;
  readonly tree: TreeState;
  readonly chevron: ReactNode;
  readonly below: ReactNode;
}) => {
  const commands = useLibraryCommands();

  return (
    <>
      <SidebarMenuItem>
        {chevron}
        <SidebarMenuButton
          isActive={tree.openItem === id}
          icon={FileTextIcon}
          style={indentOf(depth)}
          onClick={() => {
            commands.openItem(id);
          }}
        >
          {title}
        </SidebarMenuButton>
      </SidebarMenuItem>
      {below}
    </>
  );
};

const Level = ({
  parentId,
  depth,
  tree,
  branches,
}: {
  readonly parentId: string | null;
  readonly depth: number;
  readonly tree: TreeState;
  readonly branches: ReadonlyMap<string | null, readonly Counted[]>;
}) => (
  <>
    {(branches.get(parentId) ?? []).map((node) => (
      <ContainerBranch key={node.id} node={node} depth={depth} tree={tree} branches={branches} />
    ))}
    {parentId === null ? null : <NoteRows parentId={parentId} depth={depth} tree={tree} />}
  </>
);

const ContainerBranch = ({
  node,
  depth,
  tree,
  branches,
}: {
  readonly node: Counted;
  readonly depth: number;
  readonly tree: TreeState;
  readonly branches: ReadonlyMap<string | null, readonly Counted[]>;
}) => (
  <>
    <ContainerRow node={node} depth={depth} tree={tree} />
    {node.kind === "folder" && tree.isOpen(node.id, "folder") ? (
      <Level parentId={node.id} depth={depth + 1} tree={tree} branches={branches} />
    ) : null}
  </>
);

const toggled = (ids: readonly string[], id: string) =>
  ids.includes(id) ? ids.filter((held) => held !== id) : [...ids, id];

export const LibraryTree = ({
  scope,
  openItem,
}: {
  readonly scope: LibraryScope;
  readonly openItem: string | null;
}) => {
  const containers = useQuery(useLibraryQueries().scopes()).data?.containers ?? [];
  const [closed, setClosed] = usePref(windowLayout, "railClosed");
  const [openNotes, setOpenNotes] = usePref(windowLayout, "railOpenNotes");
  const branches = childrenOf(containers);

  const tree: TreeState = {
    isOpen: (id, kind) => (kind === "folder" ? !closed.includes(id) : openNotes.includes(id)),
    openItem,
    scope,
    toggle: (id, kind) => {
      if (kind === "folder") {
        setClosed(toggled(closed, id));
      } else {
        setOpenNotes(toggled(openNotes, id));
      }
    },
  };

  return (
    <SidebarMenu aria-label="Folders">
      <Level parentId={null} depth={0} tree={tree} branches={branches} />
      <NoteRows parentId={null} depth={0} tree={tree} />
    </SidebarMenu>
  );
};
