import { useCallback, useMemo, useState } from "react";
import {
  ChevronRightIcon,
  ChevronsUpDownIcon,
  FileIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  PencilIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "@repo/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible";
import { Input } from "@repo/ui/components/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@repo/ui/components/sidebar";
import { cn } from "@repo/ui/lib/utils";

import { ThemeToggle } from "@repo/app/components/theme-toggle";
import { SettingsDialog } from "@repo/app/settings/settings-dialog";
import { useResizableSidebar } from "@repo/app/sidebar/use-resizable-sidebar";
import { buildVaultTree, type VaultTreeNode } from "@repo/app/sidebar/vault-tree";
import { useVault } from "@repo/app/workspace/vault-context";

function withName(path: string, name: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? name : `${path.slice(0, slash + 1)}${name}`;
}

export function AppSidebar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const {
    entries,
    folderName,
    editor,
    openFile,
    createFile,
    renameEntry,
    deleteEntry,
    changeFolder,
  } = useVault();

  const { handleMouseDown } = useResizableSidebar();
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  const tree = useMemo(() => buildVaultTree(entries), [entries]);

  const handleCreate = useCallback(() => {
    const name = newName;
    setNewName("");
    setAdding(false);
    void createFile(name);
  }, [newName, createFile]);

  const rowProps = {
    selectedPath: editor.path,
    renaming,
    onOpen: openFile,
    onStartRename: setRenaming,
    onCommitRename: (from: string, to: string) => {
      setRenaming(null);
      void renameEntry(from, to);
    },
    onCancelRename: () => setRenaming(null),
    onDelete: (path: string) => void deleteEntry(path),
  };

  return (
    <Sidebar collapsible="offcanvas" className="border-r border-border">
      {/* `pt-8` reserves a draggable strip for the macOS traffic lights, which
       * sit at window (16,16) and would otherwise overlap the folder switcher. */}
      <SidebarHeader className="app-drag gap-1.5 px-2 pt-9 pb-1">
        <button
          type="button"
          onClick={() => void changeFolder()}
          title={`${folderName || "Choose folder"} — click to switch vault`}
          className="app-no-drag flex w-full min-w-0 items-center gap-2 rounded-lg p-1.5 text-left transition-colors hover:bg-sidebar-accent"
        >
          <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">{folderName || "Choose folder…"}</span>
          <ChevronsUpDownIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
        </button>
        <button
          type="button"
          onClick={onOpenPalette}
          title="Search notes & run commands (⌘K)"
          className="app-no-drag flex w-full items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-left shadow-xs transition-colors hover:bg-accent"
        >
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            Quick actions
          </span>
          <kbd className="rounded border border-border px-1 py-px text-[10px] font-medium text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup className="gap-1 p-0">
          <div className="flex items-center justify-between pr-1">
            <SidebarGroupLabel>Notes</SidebarGroupLabel>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAdding((v) => !v)}
              className="size-5 shrink-0 px-0 text-muted-foreground hover:text-foreground"
              title="New note"
            >
              <FilePlusIcon className="size-3.5" />
            </Button>
          </div>
          {adding && (
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim().length > 0) handleCreate();
                if (e.key === "Escape") {
                  setNewName("");
                  setAdding(false);
                }
              }}
              onBlur={() => {
                if (newName.trim().length === 0) setAdding(false);
              }}
              placeholder="note-name.md"
              className="mb-1 h-7 text-xs"
            />
          )}
          {entries.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              No notes yet. Create one with the + button.
            </p>
          ) : (
            <SidebarMenu>
              <TreeNodes nodes={tree} {...rowProps} />
            </SidebarMenu>
          )}
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="flex-row items-center justify-between border-t border-sidebar-border p-2">
        <ThemeToggle />
        <SettingsDialog />
      </SidebarFooter>

      {/* Drag-to-resize handle, pinned to the sidebar's right edge. Hidden when
       * the sidebar is collapsed off-canvas (it would otherwise sit at the
       * screen's left edge). */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={handleMouseDown}
        className="app-no-drag absolute top-0 right-0 z-20 h-full w-1 cursor-col-resize bg-transparent transition-colors duration-200 group-data-[collapsible=offcanvas]:hidden hover:bg-primary/50 active:bg-primary"
      />
    </Sidebar>
  );
}

type RowHandlers = {
  selectedPath: string | null;
  renaming: string | null;
  onOpen: (path: string) => void;
  onStartRename: (path: string) => void;
  onCommitRename: (from: string, to: string) => void;
  onCancelRename: () => void;
  onDelete: (path: string) => void;
};

function TreeNodes({ nodes, ...handlers }: { nodes: VaultTreeNode[] } & RowHandlers) {
  return (
    <>
      {nodes.map((node) =>
        node.type === "folder" ? (
          <SidebarMenuItem key={node.path}>
            <Collapsible defaultOpen className="group/collapsible">
              <CollapsibleTrigger
                render={
                  <SidebarMenuButton className="data-[panel-open]:font-normal">
                    <ChevronRightIcon className="transition-transform group-data-[panel-open]/collapsible:rotate-90" />
                    <FolderIcon />
                    <span>{node.name}</span>
                  </SidebarMenuButton>
                }
              />
              <CollapsibleContent>
                <SidebarMenuSub>
                  <TreeNodes nodes={node.children} {...handlers} />
                </SidebarMenuSub>
              </CollapsibleContent>
            </Collapsible>
          </SidebarMenuItem>
        ) : (
          <FileRow
            key={node.path}
            name={node.name}
            path={node.path}
            kind={node.kind}
            {...handlers}
          />
        ),
      )}
    </>
  );
}

function FileRow({
  name,
  path,
  kind,
  selectedPath,
  renaming,
  onOpen,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
}: { name: string; path: string; kind: "doc" | "other" } & RowHandlers) {
  const [draft, setDraft] = useState(name);

  if (renaming === path) {
    return (
      <SidebarMenuItem>
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename(path, withName(path, draft.trim()));
            if (e.key === "Escape") onCancelRename();
          }}
          onBlur={onCancelRename}
          className="h-7 text-xs"
        />
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        isActive={selectedPath === path}
        onClick={() => onOpen(path)}
        className={cn(selectedPath === path && "bg-sidebar-accent text-sidebar-accent-foreground")}
      >
        {kind === "doc" ? <FileTextIcon /> : <FileIcon />}
        <span>{name}</span>
      </SidebarMenuButton>
      <SidebarMenuAction
        showOnHover
        title="Rename"
        className="right-7"
        onClick={() => {
          setDraft(name);
          onStartRename(path);
        }}
      >
        <PencilIcon />
      </SidebarMenuAction>
      <SidebarMenuAction
        showOnHover
        title="Delete"
        className="hover:text-destructive"
        onClick={() => {
          if (window.confirm(`Delete ${path}?`)) onDelete(path);
        }}
      >
        <Trash2Icon />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}
