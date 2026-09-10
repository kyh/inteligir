import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/components/dropdown-menu";
import { useSidebarRow } from "@repo/ui/components/sidebar";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "cn";
import { DEFAULT_DOC_EXTENSION, isDocPath } from "@repo/notes/knowledge/doc-file";
import { checkNoteName, noteNameErrorMessage } from "@repo/notes/knowledge/note-name";
import { basenamePath, dirnamePath, extnamePath, joinPath } from "@repo/notes/knowledge/vault-path";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { ChevronRightIcon, EllipsisIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import type { TreeSort } from "../prefs";
import { absoluteEntryPath, planMove } from "./tree-ops";
import type { TreeState } from "./tree-state";

export interface TreeOps {
  createNote: (path: string) => void;
  createFolder: (path: string) => void;
  renameEntry: (fromPath: string, toPath: string) => void;
  // into `toDir` ("" is the vault root), keeping the entry's own name
  moveEntry: (fromPath: string, toDir: string) => void;
  removeEntry: (path: string, kind: "file" | "dir") => void;
  setPinned: (path: string, pinned: boolean) => void;
  // present under the shell alone: the OS is reached through main, and a browser tab has no main
  revealEntry?: (path: string) => void;
  openEntry?: (path: string) => void;
}

export type TreeLoadState = "loading" | "loaded" | "failed";

export interface PendingCreate {
  kind: "file" | "dir";
  parentDir: string;
}

export interface FileTreeProps {
  entries: readonly VaultEntry[];
  loadState: TreeLoadState;
  onRetry: () => void;
  openPath: string | null;
  onOpenFile: (path: string) => void;
  ops: TreeOps;
  // the fold and focus state, owned by the rail so its header can act on it
  state: TreeState;
  // a create the header started: the input row shows until it commits or cancels
  pendingCreate: PendingCreate | null;
  onPendingCreateDone: () => void;
  // the folder the listing is rooted at ("" is the vault): its children are the top-level rows
  rootDir: string;
  // the keyboard path to a move: the caller opens its folder picker for this entry
  onMoveRequest: (path: string) => void;
  // which notes the index holds pinned; the row menu's verb follows it
  pinnedPaths: ReadonlySet<string>;
  // folders first either way; "modified" orders the files in a folder newest first
  sort: TreeSort;
  onSortChange: (sort: TreeSort) => void;
  // a substring of a name; rows that neither match nor hold a match are withheld
  filter: string;
  // the vault's absolute root, for the absolute path row; null until the listing answers
  vaultRoot: string | null;
}

// a file row stands for its folder: dropping beside a note puts the entry next to it
const dropDirFor = (node: TreeNode): string =>
  node.kind === "dir" ? node.path : dirnamePath(node.path);

interface TreeNode {
  path: string;
  name: string;
  kind: "dir" | "file";
  modifiedMs: number | null;
  children: TreeNode[];
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const compareNodes = (a: TreeNode, b: TreeNode, sort: TreeSort): number => {
  if (a.kind !== b.kind) {
    return a.kind === "dir" ? -1 : 1;
  }
  if (sort === "modified" && a.kind === "file") {
    const byTime = (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0);
    if (byTime !== 0) {
      return byTime;
    }
  }
  return byName.compare(a.name, b.name);
};

const sortTree = (nodes: TreeNode[], sort: TreeSort): void => {
  nodes.sort((a, b) => compareNodes(a, b, sort));
  for (const node of nodes) {
    sortTree(node.children, sort);
  }
};

const buildTree = (entries: readonly VaultEntry[], sort: TreeSort) => {
  const roots: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();
  for (const entry of entries) {
    const node: TreeNode = {
      children: [],
      kind: entry.kind,
      modifiedMs: entry.kind === "file" ? (entry.modifiedMs ?? null) : null,
      name: basenamePath(entry.path),
      path: entry.path,
    };
    byPath.set(entry.path, node);
    const parentDir = dirnamePath(entry.path);
    const parent = parentDir === "" ? undefined : byPath.get(parentDir);
    (parent?.children ?? roots).push(node);
  }
  sortTree(roots, sort);
  return roots;
};

// the matches and every folder above them, so a folder holding a match is never hidden
const filteredPaths = (nodes: readonly TreeNode[], needle: string): ReadonlySet<string> => {
  const kept = new Set<string>();
  const visit = (node: TreeNode): boolean => {
    let keep = node.name.toLowerCase().includes(needle);
    for (const child of node.children) {
      if (visit(child)) {
        keep = true;
      }
    }
    if (keep) {
      kept.add(node.path);
    }
    return keep;
  };
  for (const node of nodes) {
    visit(node);
  }
  return kept;
};

type EditingState =
  | { mode: "rename"; path: string }
  | { mode: "create"; kind: "dir" | "file"; parentDir: string };

type Row = { kind: "node"; node: TreeNode; depth: number } | { kind: "editor"; depth: number };

// while a filter is on, every kept folder is open: a match is worth nothing folded away
const visibleRows = (
  nodes: readonly TreeNode[],
  expanded: ReadonlySet<string>,
  kept: ReadonlySet<string> | null,
  editing: EditingState | null,
  rootDir: string,
  depth: number,
  out: Row[],
): void => {
  if (editing?.mode === "create" && editing.parentDir === rootDir && depth === 0) {
    out.push({ depth: 0, kind: "editor" });
  }
  for (const node of nodes) {
    if (kept !== null && !kept.has(node.path)) {
      continue;
    }
    out.push({ depth, kind: "node", node });
    if (node.kind === "dir" && (kept !== null || expanded.has(node.path))) {
      if (editing?.mode === "create" && editing.parentDir === node.path) {
        out.push({ depth: depth + 1, kind: "editor" });
      }
      visibleRows(node.children, expanded, kept, editing, rootDir, depth + 1, out);
    }
  }
};

const copyText = (text: string): void => {
  void (async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.error("Could not copy");
      return;
    }
    toast.success("Copied");
  })();
};

const withAncestorsExpanded = (current: ReadonlySet<string>, path: string): Set<string> => {
  const next = new Set(current);
  const segments = path.split("/");
  for (let i = 1; i < segments.length; i += 1) {
    next.add(segments.slice(0, i).join("/"));
  }
  return next;
};

const InlineNameInput = ({
  initialValue,
  depth,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  depth: number;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelledRef = useRef(false);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const commit = (): void => {
    const value = inputRef.current?.value.trim() ?? "";
    if (cancelledRef.current || value === "") {
      onCancel();
      return;
    }
    const verdict = checkNoteName(value);
    if (!verdict.ok) {
      toast.error(noteNameErrorMessage(verdict.reason));
      onCancel();
      return;
    }
    onCommit(verdict.name);
  };
  return (
    <div className="px-1" style={{ paddingLeft: depth * 12 + 4 }}>
      <input
        ref={inputRef}
        defaultValue={initialValue}
        aria-label="Name"
        className="w-full rounded-md border border-ring bg-background px-1.5 py-0.5 text-[length:inherit] outline-none"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelledRef.current = true;
            onCancel();
          }
          event.stopPropagation();
        }}
        onBlur={commit}
      />
    </div>
  );
};

const EmptyRows = ({ loadState, onRetry }: { loadState: TreeLoadState; onRetry: () => void }) => {
  if (loadState === "loading") {
    return <p className="px-1 py-2 text-xs text-muted-foreground">Loading…</p>;
  }
  if (loadState === "loaded") {
    return <p className="px-1 py-2 text-xs text-muted-foreground">The vault is empty.</p>;
  }
  return (
    <div className="px-1 py-2 text-xs">
      <p className="text-destructive">The vault could not be read.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded px-1 py-0.5 text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Try again
      </button>
    </div>
  );
};

const rowClassName = (base: string, isDropTarget: boolean, isDragged: boolean): string =>
  cn(
    base,
    "group cursor-default pr-1",
    isDropTarget && "bg-primary/10 text-foreground",
    isDragged && "opacity-50",
  );

// a right-click on a row, or on the listing's empty area (the root's own verbs)
type TreeMenu =
  | { kind: "row"; node: TreeNode; anchor: HTMLElement }
  | { kind: "root"; point: { x: number; y: number } };

interface RowMenuProps {
  menu: TreeMenu | null;
  onClose: () => void;
  onStartCreate: (parentDir: string, kind: "file" | "dir") => void;
  onStartRename: (path: string) => void;
  onMoveRequest: (path: string) => void;
  ops: TreeOps;
  pinnedPaths: ReadonlySet<string>;
  vaultRoot: string | null;
  rootDir: string;
  sort: TreeSort;
  onSortChange: (sort: TreeSort) => void;
  onCollapseAll: () => void;
}

// the empty area is not a row, so the menu anchors to the pointer
const pointAnchor = (point: { x: number; y: number }): DOMRect =>
  new DOMRect(point.x, point.y, 0, 0);

// The verbs the tree offers by right-click: a folder's creates over that folder, the listing's
// over its root with the sort and the fold beside them. Lifted out of the tree so the tree
// renders rows.
const RowMenu = ({
  menu,
  onClose,
  onStartCreate,
  onStartRename,
  onMoveRequest,
  ops,
  pinnedPaths,
  vaultRoot,
  rootDir,
  sort,
  onSortChange,
  onCollapseAll,
}: RowMenuProps) => {
  const createItems = (dirPath: string) => (
    <>
      <DropdownMenuItem
        onClick={() => {
          onClose();
          onStartCreate(dirPath, "file");
        }}
      >
        New note
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => {
          onClose();
          onStartCreate(dirPath, "dir");
        }}
      >
        New folder
      </DropdownMenuItem>
    </>
  );
  const content = (): React.ReactNode => {
    if (menu === null) {
      return null;
    }
    if (menu.kind === "root") {
      return (
        <DropdownMenuContent
          anchor={{ getBoundingClientRect: () => pointAnchor(menu.point) }}
          align="start"
          side="bottom"
        >
          {createItems(rootDir)}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              onClose();
              onSortChange(sort === "name" ? "modified" : "name");
            }}
          >
            {sort === "name" ? "Sort by modified" : "Sort by name"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              onClose();
              onCollapseAll();
            }}
          >
            Collapse all
          </DropdownMenuItem>
        </DropdownMenuContent>
      );
    }
    return (
      <DropdownMenuContent anchor={menu.anchor} align="start" side="bottom">
        {menu.node.kind === "dir" ? (
          <>
            {createItems(menu.node.path)}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          onClick={() => {
            const target = menu.node;
            onClose();
            onStartRename(target.path);
          }}
        >
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            const target = menu.node.path;
            onClose();
            copyText(target);
          }}
        >
          Copy path
        </DropdownMenuItem>
        {vaultRoot === null ? null : (
          <DropdownMenuItem
            onClick={() => {
              const target = menu.node.path;
              onClose();
              copyText(absoluteEntryPath(vaultRoot, target));
            }}
          >
            Copy absolute path
          </DropdownMenuItem>
        )}
        {ops.revealEntry === undefined ? null : (
          <DropdownMenuItem
            onClick={() => {
              const target = menu.node.path;
              onClose();
              ops.revealEntry?.(target);
            }}
          >
            Reveal in Finder
          </DropdownMenuItem>
        )}
        {ops.openEntry === undefined || menu.node.kind !== "file" ? null : (
          <DropdownMenuItem
            onClick={() => {
              const target = menu.node.path;
              onClose();
              ops.openEntry?.(target);
            }}
          >
            Open with default app
          </DropdownMenuItem>
        )}
        {menu.node.kind === "file" && isDocPath(menu.node.path) ? (
          <DropdownMenuItem
            onClick={() => {
              const target = menu.node.path;
              onClose();
              ops.setPinned(target, !pinnedPaths.has(target));
            }}
          >
            {pinnedPaths.has(menu.node.path) ? "Unpin" : "Pin"}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onClick={() => {
            const target = menu.node;
            onClose();
            onMoveRequest(target.path);
          }}
        >
          Move to…
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            const target = menu.node;
            onClose();
            ops.removeEntry(target.path, target.kind);
          }}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    );
  };
  return (
    <DropdownMenu
      open={menu !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {content()}
    </DropdownMenu>
  );
};

export const FileTree = ({
  entries,
  loadState,
  onRetry,
  openPath,
  onOpenFile,
  ops,
  state,
  pendingCreate,
  onPendingCreateDone,
  rootDir,
  onMoveRequest,
  pinnedPaths,
  sort,
  onSortChange,
  filter,
  vaultRoot,
}: FileTreeProps) => {
  const { expanded, setExpanded, activePath, setActivePath, collapseAll } = state;
  const rowBase = useSidebarRow();
  const roots = useMemo(() => buildTree(entries, sort), [entries, sort]);
  const needle = filter.trim().toLowerCase();
  const kept = useMemo(
    () => (needle === "" ? null : filteredPaths(roots, needle)),
    [roots, needle],
  );

  const [editing, setEditing] = useState<EditingState | null>(null);
  const [menu, setMenu] = useState<TreeMenu | null>(null);
  // the drag's source is component state, not dataTransfer: a drop reads it synchronously
  // and a drag that started elsewhere (a file from the desktop) has no source here
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropDir, setDropDir] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const endDrag = (): void => {
    setDragging(null);
    setDropDir(null);
  };

  // a row answers for itself even when it refuses, or the refusal would bubble to the
  // container and land the entry at the root instead
  const dragOverDir = (event: DragEvent, dir: string): void => {
    if (dragging === null) {
      return;
    }
    event.stopPropagation();
    if (!planMove(dragging, dir).ok) {
      setDropDir(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropDir(dir);
  };

  const dropIntoDir = (event: DragEvent, dir: string): void => {
    if (dragging === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const from = dragging;
    endDrag();
    if (planMove(from, dir).ok) {
      ops.moveEntry(from, dir);
    }
  };

  // The header's create is the rail's state until the input commits or cancels; the row menu's
  // edits are the tree's own. Both draw the one input row. The parent folder opens during
  // render so the row is in the first paint.
  const activeEditing: EditingState | null =
    pendingCreate === null
      ? editing
      : { kind: pendingCreate.kind, mode: "create", parentDir: pendingCreate.parentDir };
  const openParentForCreate = (create: PendingCreate | null): void => {
    if (create !== null && create.parentDir !== "") {
      setExpanded((current) => new Set(current).add(create.parentDir));
    }
  };
  const [expandedForCreate, setExpandedForCreate] = useState<PendingCreate | null>(null);
  if (expandedForCreate !== pendingCreate) {
    setExpandedForCreate(pendingCreate);
    openParentForCreate(pendingCreate);
  }
  const stopEditing = (): void => {
    setEditing(null);
    if (pendingCreate !== null) {
      onPendingCreateDone();
    }
  };

  // Keyed on entries alone: reconciling on every activePath change would clear
  // an optimistic rename-follow before the refetched tree confirms it.
  const clearActiveIfGone = (): void => {
    if (activePath !== null && !entries.some((entry) => entry.path === activePath)) {
      setActivePath(null);
    }
  };
  const [reconciledEntries, setReconciledEntries] = useState(entries);
  if (reconciledEntries !== entries) {
    setReconciledEntries(entries);
    clearActiveIfGone();
  }

  // Seeded null so a tree mounting on an already-open note expands to it.
  const expandToOpenNote = (path: string | null): void => {
    if (path !== null && path.includes("/")) {
      setExpanded((current) => withAncestorsExpanded(current, path));
    }
  };
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  if (expandedFor !== openPath) {
    setExpandedFor(openPath);
    expandToOpenNote(openPath);
  }

  const rows: Row[] = [];
  visibleRows(roots, expanded, kept, activeEditing, rootDir, 0, rows);
  const nodeRows = rows.filter((row): row is Extract<Row, { kind: "node" }> => row.kind === "node");

  const toggleDir = (path: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Resolved from the DOM rather than per-row ref callbacks: an inline ref
  // arrow has a new identity every render, so React re-attached every row's
  // ref whenever anything moved.
  const focusPath = (path: string): void => {
    setActivePath(path);
    for (const candidate of treeRef.current?.querySelectorAll<HTMLElement>("[data-path]") ?? []) {
      if (candidate.dataset.path === path) {
        candidate.focus();
        return;
      }
    }
  };

  const activate = (node: TreeNode): void => {
    if (node.kind === "dir") {
      toggleDir(node.path);
    } else {
      onOpenFile(node.path);
    }
  };

  const focusRow = (row: Extract<Row, { kind: "node" }> | undefined): void => {
    if (row) {
      focusPath(row.node.path);
    }
  };

  // Right opens a folder, then walks into it; left closes it, else climbs to its parent.
  const stepIn = (node: TreeNode, index: number): void => {
    if (node.kind !== "dir") {
      return;
    }
    if (!expanded.has(node.path)) {
      toggleDir(node.path);
      return;
    }
    const next = nodeRows[index + 1];
    if (next && dirnamePath(next.node.path) === node.path) {
      focusPath(next.node.path);
    }
  };

  const stepOut = (node: TreeNode): void => {
    if (node.kind === "dir" && expanded.has(node.path)) {
      toggleDir(node.path);
      return;
    }
    const parent = dirnamePath(node.path);
    if (parent !== rootDir) {
      focusPath(parent);
    }
  };

  const handleRowKeyDown = (event: React.KeyboardEvent, node: TreeNode): void => {
    const index = nodeRows.findIndex((row) => row.node.path === node.path);
    switch (event.key) {
      case "ArrowDown": {
        focusRow(nodeRows[index + 1]);
        break;
      }
      case "ArrowUp": {
        focusRow(nodeRows[index - 1]);
        break;
      }
      case "ArrowRight": {
        stepIn(node, index);
        break;
      }
      case "ArrowLeft": {
        stepOut(node);
        break;
      }
      case "Enter":
      case " ": {
        activate(node);
        break;
      }
      case "Home": {
        focusRow(nodeRows[0]);
        break;
      }
      case "End": {
        focusRow(nodeRows.at(-1));
        break;
      }
      case "F2": {
        setEditing({ mode: "rename", path: node.path });
        break;
      }
      default: {
        return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const commitRename = (node: { path: string }, newName: string): void => {
    stopEditing();
    const toPath = joinPath(dirnamePath(node.path), newName);
    if (toPath !== node.path) {
      // The reconcile above clears this if the rename never lands.
      setActivePath(toPath);
      ops.renameEntry(node.path, toPath);
    }
  };

  const commitCreate = (create: EditingState & { mode: "create" }, name: string): void => {
    stopEditing();
    const fileName =
      create.kind === "file" && extnamePath(name) === "" ? `${name}${DEFAULT_DOC_EXTENSION}` : name;
    const path = joinPath(create.parentDir, fileName);
    if (create.kind === "file") {
      ops.createNote(path);
    } else {
      ops.createFolder(path);
    }
  };

  const createRow = (row: Extract<Row, { kind: "editor" }>) => {
    if (activeEditing?.mode !== "create") {
      return null;
    }
    const createState = activeEditing;
    return (
      <InlineNameInput
        key="create-editor"
        initialValue=""
        depth={row.depth}
        onCommit={(name) => {
          commitCreate(createState, name);
        }}
        onCancel={stopEditing}
      />
    );
  };

  const renameRow = (row: Extract<Row, { kind: "node" }>) => (
    <InlineNameInput
      key={row.node.path}
      initialValue={row.node.name}
      depth={row.depth}
      onCommit={(name) => {
        commitRename(row.node, name);
      }}
      onCancel={stopEditing}
    />
  );

  // The tab stop must be a visible row, or the tree has no reachable stop.
  const visible = (path: string | null): string | null =>
    path !== null && nodeRows.some((row) => row.node.path === path) ? path : null;
  const tabStopPath = visible(activePath) ?? visible(openPath) ?? nodeRows[0]?.node.path ?? null;

  return (
    <div
      tabIndex={0}
      ref={treeRef}
      role="tree"
      aria-label="Vault files"
      className={cn(
        "flex min-h-full flex-col py-1",
        dropDir === rootDir && dragging !== null && "ring-1 ring-primary/40 ring-inset",
      )}
      onDragOver={(event) => {
        dragOverDir(event, rootDir);
      }}
      onDrop={(event) => {
        dropIntoDir(event, rootDir);
      }}
      onContextMenu={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        event.preventDefault();
        setMenu({ kind: "root", point: { x: event.clientX, y: event.clientY } });
      }}
    >
      {rows.map((row) => {
        if (row.kind === "editor") {
          return createRow(row);
        }
        const { node } = row;
        if (activeEditing?.mode === "rename" && activeEditing.path === node.path) {
          return renameRow(row);
        }
        const isOpen = node.kind === "file" && node.path === openPath;
        const isExpanded = node.kind === "dir" && (kept !== null || expanded.has(node.path));
        const isDropTarget = node.kind === "dir" && dropDir === node.path && dragging !== null;
        return (
          <div
            key={node.path}
            role="treeitem"
            aria-level={row.depth + 1}
            {...(node.kind === "dir" ? { "aria-expanded": isExpanded } : {})}
            aria-selected={isOpen}
            data-path={node.path}
            tabIndex={node.path === tabStopPath ? 0 : -1}
            draggable
            {...(isOpen ? { "data-active": "" } : {})}
            className={rowClassName(rowBase, isDropTarget, dragging === node.path)}
            style={{ paddingLeft: row.depth * 12 + 4 }}
            onClick={() => {
              setActivePath(node.path);
              activate(node);
            }}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", node.path);
              setDragging(node.path);
            }}
            onDragEnd={endDrag}
            onDragOver={(event) => {
              dragOverDir(event, dropDirFor(node));
            }}
            onDrop={(event) => {
              dropIntoDir(event, dropDirFor(node));
            }}
            onKeyDown={(event) => {
              handleRowKeyDown(event, node);
            }}
            onFocus={() => {
              setActivePath(node.path);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ anchor: event.currentTarget, kind: "row", node });
            }}
          >
            {node.kind === "dir" ? (
              <ChevronRightIcon
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform",
                  isExpanded && "rotate-90",
                )}
              />
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Actions for ${node.name}`}
              className="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-muted-foreground/10 data-open:opacity-100"
              {...(menu?.kind === "row" && menu.node.path === node.path ? { "data-open": "" } : {})}
              onClick={(event) => {
                event.stopPropagation();
                setMenu({ anchor: event.currentTarget, kind: "row", node });
              }}
            >
              <EllipsisIcon className="size-3.5" />
            </button>
          </div>
        );
      })}
      {entries.length === 0 && activeEditing === null ? (
        <EmptyRows loadState={loadState} onRetry={onRetry} />
      ) : null}
      {kept !== null && rows.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">No note matches the search.</p>
      ) : null}
      <RowMenu
        menu={menu}
        onClose={() => {
          setMenu(null);
        }}
        onStartCreate={(parentDir, kind) => {
          setExpanded((current) => new Set(current).add(parentDir));
          setEditing({ kind, mode: "create", parentDir });
        }}
        onStartRename={(path) => {
          setEditing({ mode: "rename", path });
        }}
        onMoveRequest={onMoveRequest}
        ops={ops}
        pinnedPaths={pinnedPaths}
        vaultRoot={vaultRoot}
        rootDir={rootDir}
        sort={sort}
        onSortChange={onSortChange}
        onCollapseAll={collapseAll}
      />
    </div>
  );
};
