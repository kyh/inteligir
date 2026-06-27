import { useCallback, useMemo, useState } from "react";
import {
  ChevronRightIcon,
  FileIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  PencilIcon,
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
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@repo/ui/components/sidebar";
import { cn } from "@repo/ui/lib/utils";

import { ThemeToggle } from "@/renderer/components/theme-toggle";
import { SettingsDialog } from "@/renderer/settings/settings-dialog";
import { buildVaultTree, type VaultTreeNode } from "@/renderer/sidebar/vault-tree";
import { useVault } from "@/renderer/workspace/vault-context";

function withName(path: string, name: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? name : `${path.slice(0, slash + 1)}${name}`;
}

export function AppSidebar() {
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

  const [filter, setFilter] = useState("");
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);

  const tree = useMemo(() => buildVaultTree(entries), [entries]);
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? entries.filter((e) => e.path.toLowerCase().includes(q)) : null;
  }, [entries, filter]);

  const handleCreate = useCallback(() => {
    const name = newName;
    setNewName("");
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
    <Sidebar>
      <SidebarHeader className="app-drag gap-2 pt-8">
        <div className="app-no-drag flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void changeFolder()}
            title={folderName}
            className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-sidebar-foreground hover:text-foreground"
          >
            <FolderIcon className="size-4 shrink-0" />
            <span className="truncate">{folderName || "Choose folder…"}</span>
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void changeFolder()}
            className="h-6 shrink-0 px-1.5 text-[11px] text-muted-foreground"
          >
            Change
          </Button>
        </div>
        <div className="app-no-drag flex items-center gap-1.5">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            placeholder="new-note.md"
            className="h-7 text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleCreate}
            disabled={newName.trim().length === 0}
            className="size-7 shrink-0 px-0"
            title="Create note"
          >
            <FilePlusIcon className="size-4" />
          </Button>
        </div>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter notes"
          className="h-7 text-xs"
        />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="py-0">
          {entries.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              No notes yet. Create one above.
            </p>
          ) : filtered ? (
            <SidebarMenu>
              {filtered.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No matches.</p>
              ) : (
                filtered.map((e) => (
                  <FileRow key={e.path} name={e.path} path={e.path} kind={e.kind} {...rowProps} />
                ))
              )}
            </SidebarMenu>
          ) : (
            <SidebarMenu>
              <TreeNodes nodes={tree} {...rowProps} />
            </SidebarMenu>
          )}
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="flex-row items-center justify-between border-t border-sidebar-border">
        <ThemeToggle />
        <SettingsDialog />
      </SidebarFooter>
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
