import { memo, useCallback, useMemo, useState } from "react";
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
  WaypointsIcon,
} from "lucide-react";

import { Button } from "@repo/ui/components/button";
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
} from "@repo/ui/components/sidebar";
import { cn } from "@repo/ui/lib/utils";

import { confirmVaultDelete } from "@renderer/components/confirm-vault-delete";
import { ThemeToggle } from "@renderer/components/theme-toggle";
import { SettingsDialog } from "@renderer/settings/settings-dialog";
import { flattenTree, resolveTreeKey, type FlatRow } from "@renderer/sidebar/tree-navigation";
import { useResizableSidebar } from "@renderer/sidebar/use-resizable-sidebar";
import { buildVaultTree } from "@renderer/sidebar/vault-tree";
import { useViewStore } from "@renderer/stores/view-store";
import { useOpenNote } from "@renderer/workspace/open-note-store";
import { useVaultActions, useVaultListing } from "@renderer/workspace/vault-context";

function withName(path: string, name: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? name : `${path.slice(0, slash + 1)}${name}`;
}

// VS Code / Zed tree geometry. Depth is expressed as left padding INSIDE each
// full-width row (never a nested container), so hover/active highlight always
// spans the full sidebar width. Files reserve a chevron-width spacer so their
// icon lines up under a sibling folder's icon.
const INDENT_BASE = 8; // px before the first level's chevron/spacer
const INDENT_STEP = 14; // px added per nesting level
const CHEVRON = 14; // chevron / spacer column width (matches [&_svg]:size-3.5)

function rowPadding(depth: number): number {
  return INDENT_BASE + depth * INDENT_STEP;
}

export function AppSidebar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { entries, folderName } = useVaultListing();
  const { openFile, createFile, renameEntry, deleteEntry, changeFolder } = useVaultActions();
  // The tree re-renders on navigation + structural refresh — never on typing
  // (the open note's CONTENT is not a subscription here, only its path, #470).
  const selectedPath = useOpenNote((s) => s.editor.path);

  const { handlePointerDown } = useResizableSidebar();
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Folder paths the user has collapsed. Default open (empty set), not
  // persisted — persistence is out of scope.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  // Roving-tabindex focus: exactly one row is tabbable at a time.
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  const tree = useMemo(() => buildVaultTree(entries), [entries]);
  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);
  // The tabbable row: the focused one if still visible, else the first row.
  const activePath = rows.some((r) => r.node.path === focusedPath)
    ? focusedPath
    : (rows[0]?.node.path ?? null);

  const handleCreate = useCallback(() => {
    const name = newName;
    setNewName("");
    setAdding(false);
    void createFile(name);
  }, [newName, createFile]);

  const surface = useViewStore((s) => s.surface);
  const setSurface = useViewStore((s) => s.setSurface);

  const toggleFolder = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleTreeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      const command = resolveTreeKey(rows, activePath, event.key);
      if (!command) return;
      // Enter/Space activation is left to the native <button> click (Space on
      // keyup, Enter on keydown) so folders toggle / files open exactly once —
      // resolveTreeKey still models it for unit tests.
      if (command.kind === "activate") return;
      event.preventDefault();
      switch (command.kind) {
        case "focus": {
          setFocusedPath(command.path);
          const el = event.currentTarget.querySelector<HTMLElement>(
            `[data-tree-path="${CSS.escape(command.path)}"]`,
          );
          el?.focus();
          break;
        }
        case "expand":
          setCollapsed((prev) => {
            const next = new Set(prev);
            next.delete(command.path);
            return next;
          });
          break;
        case "collapse":
          setCollapsed((prev) => new Set(prev).add(command.path));
          break;
      }
    },
    [rows, activePath],
  );

  // Handlers hoisted into ONE stable object (every dep is a stable action or
  // setState), so a memoized TreeRow only re-renders when ITS row/selection/
  // rename state changes — not whenever the tree does (#470 interim win).
  const onCommitRename = useCallback(
    (from: string, to: string) => {
      setRenaming(null);
      void renameEntry(from, to);
    },
    [renameEntry],
  );
  const onCancelRename = useCallback(() => setRenaming(null), []);
  const onDelete = useCallback((path: string) => void deleteEntry(path), [deleteEntry]);
  const rowProps = useMemo<RowHandlers>(
    () => ({
      onOpen: openFile,
      onToggleFolder: toggleFolder,
      onFocusRow: setFocusedPath,
      onStartRename: setRenaming,
      onCommitRename,
      onCancelRename,
      onDelete,
    }),
    [openFile, toggleFolder, onCommitRename, onCancelRename, onDelete],
  );

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
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="sm"
                isActive={surface === "graph"}
                onClick={() => setSurface("graph")}
                className={cn(
                  surface === "graph" && "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
              >
                <WaypointsIcon />
                <span>Graph</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
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
            <SidebarMenu role="tree" aria-label="Notes" onKeyDown={handleTreeKeyDown}>
              {rows.map((row) => (
                <TreeRow
                  key={row.node.path}
                  row={row}
                  tabbable={row.node.path === activePath}
                  selected={row.node.path === selectedPath}
                  renaming={renaming === row.node.path}
                  {...rowProps}
                />
              ))}
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
        onPointerDown={handlePointerDown}
        className="app-no-drag absolute top-0 right-0 z-20 h-full w-1 cursor-col-resize bg-transparent transition-colors duration-200 group-data-[collapsible=offcanvas]:hidden hover:bg-primary/50 active:bg-primary"
      />
    </Sidebar>
  );
}

type RowHandlers = {
  onOpen: (path: string) => void;
  onToggleFolder: (path: string) => void;
  onFocusRow: (path: string) => void;
  onStartRename: (path: string) => void;
  onCommitRename: (from: string, to: string) => void;
  onCancelRename: () => void;
  onDelete: (path: string) => void;
};

// Vertical indent guides (Zed-style): one quiet 1px line per ancestor level,
// positioned at that level's chevron center so guides align across every row.
function IndentGuides({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return (
    <>
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-sidebar-border/70"
          style={{ left: rowPadding(level) + CHEVRON / 2 }}
        />
      ))}
    </>
  );
}

// Memoized: a tree render (nav, structural refresh, focus move) re-renders
// only the rows whose selected/renaming/tabbable actually changed — the
// handlers object is stable and `rows` is memoized upstream (#470).
const TreeRow = memo(function TreeRow({
  row,
  tabbable,
  selected,
  renaming,
  onOpen,
  onToggleFolder,
  onFocusRow,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
}: { row: FlatRow; tabbable: boolean; selected: boolean; renaming: boolean } & RowHandlers) {
  const { node, depth } = row;
  const [draft, setDraft] = useState(node.type === "file" ? node.name : "");

  // Inline rename occupies the row as an input, indented to match.
  if (node.type === "file" && renaming) {
    return (
      <SidebarMenuItem>
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename(node.path, withName(node.path, draft.trim()));
            if (e.key === "Escape") onCancelRename();
          }}
          onBlur={onCancelRename}
          className="h-7 text-xs"
          style={{ paddingLeft: rowPadding(depth) + CHEVRON }}
        />
      </SidebarMenuItem>
    );
  }

  const commonButtonProps = {
    size: "sm" as const,
    "data-tree-path": node.path,
    role: "treeitem",
    "aria-level": depth + 1,
    tabIndex: tabbable ? 0 : -1,
    onFocus: () => onFocusRow(node.path),
  };

  if (node.type === "folder") {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          {...commonButtonProps}
          aria-expanded={row.expanded}
          onClick={() => onToggleFolder(node.path)}
          className="relative font-normal focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset"
          style={{ paddingLeft: rowPadding(depth) }}
        >
          <IndentGuides depth={depth} />
          <ChevronRightIcon className={cn("transition-transform", row.expanded && "rotate-90")} />
          <FolderIcon />
          <span>{node.name}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  const confirmDelete = async () => {
    if (await confirmVaultDelete(node.path)) onDelete(node.path);
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        {...commonButtonProps}
        isActive={selected}
        aria-selected={selected}
        onClick={() => onOpen(node.path)}
        className={cn(
          "relative focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset",
          // Clear the two hover-revealed actions (Delete at right-1, Rename at
          // right-7, w-5 each) so they never overlay the truncated name.
          "group-focus-within/menu-item:pr-12 group-hover/menu-item:pr-12",
          selected && "bg-sidebar-accent text-sidebar-accent-foreground",
        )}
        style={{ paddingLeft: rowPadding(depth) }}
      >
        <IndentGuides depth={depth} />
        {/* Empty chevron column: keeps a file's icon aligned under a sibling
         * folder's icon (files have no twistie), matching VS Code. */}
        <span aria-hidden className="size-3.5 shrink-0" />
        {node.kind === "doc" ? <FileTextIcon /> : <FileIcon />}
        <span>{node.name}</span>
      </SidebarMenuButton>
      <SidebarMenuAction
        showOnHover
        title="Rename"
        className="right-7"
        tabIndex={-1}
        onClick={() => {
          setDraft(node.name);
          onStartRename(node.path);
        }}
      >
        <PencilIcon />
      </SidebarMenuAction>
      <SidebarMenuAction
        showOnHover
        title="Delete"
        className="hover:text-destructive"
        tabIndex={-1}
        onClick={() => void confirmDelete()}
      >
        <Trash2Icon />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
});
