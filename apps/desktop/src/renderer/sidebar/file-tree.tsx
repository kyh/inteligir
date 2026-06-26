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
import { Input } from "@repo/ui/components/input";
import { cn } from "@repo/ui/lib/utils";

import { buildVaultTree, type VaultTreeNode } from "@/renderer/sidebar/vault-tree";
import { useVault } from "@/renderer/workspace/vault-context";

/** Replace the final path segment, keeping the parent folder. */
function withName(path: string, name: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? name : `${path.slice(0, slash + 1)}${name}`;
}

export function FileTree() {
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
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);

  const tree = useMemo(() => buildVaultTree(entries), [entries]);
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return null;
    return entries.filter((e) => e.path.toLowerCase().includes(q));
  }, [entries, filter]);

  const toggleFolder = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleCreate = useCallback(() => {
    const name = newName;
    setNewName("");
    void createFile(name);
  }, [newName, createFile]);

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => void changeFolder()}
          title={folderName}
          className="flex min-w-0 items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <FolderIcon className="size-3.5 shrink-0" />
          <span className="truncate font-medium">{folderName || "Choose folder…"}</span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void changeFolder()}
          className="h-auto shrink-0 px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          Change
        </Button>
      </div>

      <div className="flex flex-col gap-1.5 border-b border-border p-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files"
          className="h-6 text-[11px]"
        />
        <div className="flex items-center gap-1">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            placeholder="new-note.md"
            className="h-6 text-[11px]"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleCreate}
            disabled={newName.trim().length === 0}
            className="h-6 shrink-0 px-1.5"
            title="Create file"
          >
            <FilePlusIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1">
        {entries.length === 0 ? (
          <p className="p-2 text-[10px] text-muted-foreground">No files yet. Create one above.</p>
        ) : filtered ? (
          filtered.length === 0 ? (
            <p className="p-2 text-[10px] text-muted-foreground">No matches.</p>
          ) : (
            filtered.map((e) => (
              <FileRow
                key={e.path}
                name={e.path}
                path={e.path}
                kind={e.kind}
                depth={0}
                selected={editor.path === e.path}
                renaming={renaming === e.path}
                onOpen={() => openFile(e.path)}
                onStartRename={() => setRenaming(e.path)}
                onCommitRename={(to) => {
                  setRenaming(null);
                  void renameEntry(e.path, to);
                }}
                onCancelRename={() => setRenaming(null)}
                onDelete={() => void deleteEntry(e.path)}
              />
            ))
          )
        ) : (
          <TreeNodes
            nodes={tree}
            depth={0}
            collapsed={collapsed}
            selectedPath={editor.path}
            renaming={renaming}
            onToggleFolder={toggleFolder}
            onOpen={openFile}
            onStartRename={setRenaming}
            onCommitRename={(from, to) => {
              setRenaming(null);
              void renameEntry(from, to);
            }}
            onCancelRename={() => setRenaming(null)}
            onDelete={(path) => void deleteEntry(path)}
          />
        )}
      </div>
    </div>
  );
}

function TreeNodes({
  nodes,
  depth,
  collapsed,
  selectedPath,
  renaming,
  onToggleFolder,
  onOpen,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
}: {
  nodes: VaultTreeNode[];
  depth: number;
  collapsed: ReadonlySet<string>;
  selectedPath: string | null;
  renaming: string | null;
  onToggleFolder: (path: string) => void;
  onOpen: (path: string) => void;
  onStartRename: (path: string) => void;
  onCommitRename: (from: string, to: string) => void;
  onCancelRename: () => void;
  onDelete: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.type === "folder" ? (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => onToggleFolder(node.path)}
              style={{ paddingLeft: depth * 12 + 8 }}
              className="flex w-full items-center gap-1 rounded py-1 pr-2 text-left text-[11px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <ChevronRightIcon
                className={cn(
                  "size-3 shrink-0 transition-transform",
                  !collapsed.has(node.path) && "rotate-90",
                )}
              />
              <FolderIcon className="size-3 shrink-0" />
              <span className="truncate">{node.name}</span>
            </button>
            {!collapsed.has(node.path) && (
              <TreeNodes
                nodes={node.children}
                depth={depth + 1}
                collapsed={collapsed}
                selectedPath={selectedPath}
                renaming={renaming}
                onToggleFolder={onToggleFolder}
                onOpen={onOpen}
                onStartRename={onStartRename}
                onCommitRename={onCommitRename}
                onCancelRename={onCancelRename}
                onDelete={onDelete}
              />
            )}
          </div>
        ) : (
          <FileRow
            key={node.path}
            name={node.name}
            path={node.path}
            kind={node.kind}
            depth={depth}
            selected={selectedPath === node.path}
            renaming={renaming === node.path}
            onOpen={() => onOpen(node.path)}
            onStartRename={() => onStartRename(node.path)}
            onCommitRename={(to) => onCommitRename(node.path, to)}
            onCancelRename={onCancelRename}
            onDelete={() => onDelete(node.path)}
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
  depth,
  selected,
  renaming,
  onOpen,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
}: {
  name: string;
  path: string;
  kind: "doc" | "other";
  depth: number;
  selected: boolean;
  renaming: boolean;
  onOpen: () => void;
  onStartRename: () => void;
  onCommitRename: (to: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const indent = depth * 12 + 8;

  if (renaming) {
    return (
      <div style={{ paddingLeft: indent }} className="py-0.5 pr-2">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename(withName(path, draft.trim()));
            if (e.key === "Escape") onCancelRename();
          }}
          onBlur={onCancelRename}
          className="h-6 text-[11px]"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center rounded text-[11px]",
        selected
          ? "bg-foreground/15 text-foreground"
          : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        style={{ paddingLeft: indent }}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
      >
        {kind === "doc" ? (
          <FileTextIcon className="size-3 shrink-0" />
        ) : (
          <FileIcon className="size-3 shrink-0" />
        )}
        <span className="truncate">{name}</span>
      </button>
      <span className="flex shrink-0 items-center opacity-0 group-hover:opacity-100">
        <button
          type="button"
          onClick={() => {
            setDraft(name);
            onStartRename();
          }}
          title="Rename"
          className="px-1 py-1 text-muted-foreground hover:text-foreground"
        >
          <PencilIcon className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Delete ${path}?`)) onDelete();
          }}
          title="Delete"
          className="px-1.5 py-1 text-muted-foreground hover:text-destructive"
        >
          <Trash2Icon className="size-3" />
        </button>
      </span>
    </div>
  );
}
