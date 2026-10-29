// CLAUDE.md § A FOLDER SCOPE EXISTS. The library's folders, directories alone, each a scope a
// click shows. A row is a drop target three ways: cards dragged from the grid move
// there, a folder row dragged onto it moves under it, and files or links dragged in from outside
// the window are saved into it. The drag store tells the window's own drags from the desktop's.

import type { LibraryScope } from "@repo/domain/library-scope";
import { checkNoteName, noteNameErrorMessage } from "@repo/notes/knowledge/note-name";
import { basenamePath, dirnamePath, joinPath } from "@repo/notes/knowledge/vault-path";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/components/sidebar-menu";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/cn";
import { isImeComposing } from "@repo/ui/lib/ime";
import { plural } from "@repo/ui/lib/plural";
import { ChevronRightIcon, EllipsisIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";

import { endInternalDrag, internalDrag, startInternalDrag } from "../library/drag-store";
import { formatCount } from "../library/item-labels";
import { isEmptyPayload, payloadFrom } from "../library/capture/capture-payload";
import type { CapturePayload } from "../library/capture/capture-payload";
import { planMove } from "./tree-ops";
import type { TreeOps } from "./tree-ops";

interface FolderCount {
  readonly path: string;
  readonly items: number;
}

interface FolderNode {
  readonly path: string;
  readonly items: number;
  readonly children: FolderNode[];
}

// the listing comes parents first, so a parent is always placed before its children
const buildFolderTree = (folders: readonly FolderCount[]): FolderNode[] => {
  const roots: FolderNode[] = [];
  const byPath = new Map<string, FolderNode>();
  for (const folder of folders) {
    const node: FolderNode = { children: [], items: folder.items, path: folder.path };
    byPath.set(folder.path, node);
    const parent = byPath.get(dirnamePath(folder.path));
    (parent?.children ?? roots).push(node);
  }
  return roots;
};

type FolderEditing = { mode: "rename"; path: string } | { mode: "create"; parentDir: string };

type Row = { kind: "node"; node: FolderNode; depth: number } | { kind: "editor"; depth: number };

const visibleRows = (
  nodes: readonly FolderNode[],
  expanded: ReadonlySet<string>,
  editing: FolderEditing | null,
  parentDir: string,
  depth: number,
  out: Row[],
): void => {
  if (editing?.mode === "create" && editing.parentDir === parentDir) {
    out.push({ depth, kind: "editor" });
  }
  for (const node of nodes) {
    out.push({ depth, kind: "node", node });
    const open =
      expanded.has(node.path) || (editing?.mode === "create" && editing.parentDir === node.path);
    if (open) {
      visibleRows(node.children, expanded, editing, node.path, depth + 1, out);
    }
  }
};

const ancestorsOf = (path: string): string[] => {
  const segments = path.split("/");
  return segments.slice(1).map((_, at) => segments.slice(0, at + 1).join("/"));
};

// what a drop onto `dir` would do: move the window's own drag, else save the desktop's
const dropVerdict = (dir: string): "move" | "save" | null => {
  const dragged = internalDrag();
  if (dragged === null) {
    return "save";
  }
  return dragged.paths.some((path) => planMove(path, dir).ok) ? "move" : null;
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
        aria-label="Folder name"
        className="w-full rounded-md border border-ring bg-background px-1.5 py-0.5 text-[length:inherit] outline-none"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (isImeComposing(event)) {
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelledRef.current = true;
            onCancel();
          }
        }}
        onBlur={commit}
      />
    </div>
  );
};

export interface FolderTreeProps {
  folders: readonly FolderCount[];
  // the folder the library shows, highlighted while nothing is open over it
  activeFolder: string | null;
  onScope: (scope: LibraryScope) => void;
  ops: TreeOps;
  onMoveRequest: (paths: readonly [string, ...string[]]) => void;
  onNewNoteIn: (folder: string) => void;
  onSaveInto: (payload: CapturePayload, folder: string) => void;
  // the group's own "New folder" asks the tree for its name input at the root
  createAtRoot: number;
}

export const FolderTree = ({
  folders,
  activeFolder,
  onScope,
  ops,
  onMoveRequest,
  onNewNoteIn,
  onSaveInto,
  createAtRoot,
}: FolderTreeProps) => {
  const roots = buildFolderTree(folders);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<FolderEditing | null>(null);
  const [dropDir, setDropDir] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ node: FolderNode; anchor: HTMLElement } | null>(null);

  // the way to the shown folder opens, applied during the rail's own render
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  if (activeFolder !== expandedFor) {
    setExpandedFor(activeFolder);
    if (activeFolder !== null) {
      setExpanded((current) => new Set([...current, ...ancestorsOf(activeFolder)]));
    }
  }
  const [createSeen, setCreateSeen] = useState(createAtRoot);
  if (createAtRoot !== createSeen) {
    setCreateSeen(createAtRoot);
    setEditing({ mode: "create", parentDir: "" });
  }

  const toggle = (path: string): void => {
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

  const onDragOver = (event: DragEvent, dir: string): void => {
    const verdict = dropVerdict(dir);
    // a row answers for itself even when it refuses, or the window would take the drop
    event.stopPropagation();
    if (verdict === null) {
      setDropDir(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = verdict === "move" ? "move" : "copy";
    setDropDir(dir);
  };

  const moveInto = async (paths: readonly string[], dir: string): Promise<void> => {
    let moved = 0;
    for (const path of paths) {
      if (planMove(path, dir).ok && (await ops.moveEntry(path, dir))) {
        moved += 1;
      }
    }
    if (moved > 0) {
      toast.success(`Moved ${plural(moved, "item")} to ${basenamePath(dir)}`);
    }
  };

  const onDrop = (event: DragEvent, dir: string): void => {
    setDropDir(null);
    const verdict = dropVerdict(dir);
    event.stopPropagation();
    if (verdict === null) {
      return;
    }
    event.preventDefault();
    const dragged = internalDrag();
    endInternalDrag();
    if (dragged !== null) {
      void moveInto(dragged.paths, dir);
      return;
    }
    const payload = payloadFrom(event.dataTransfer);
    if (!isEmptyPayload(payload)) {
      onSaveInto(payload, dir);
    }
  };

  const commitRename = (path: string, name: string): void => {
    setEditing(null);
    const to = joinPath(dirnamePath(path), name);
    if (to !== path) {
      void ops.renameEntry(path, to);
    }
  };

  const commitCreate = (parentDir: string, name: string): void => {
    setEditing(null);
    const path = joinPath(parentDir, name);
    ops.createFolder(path);
    if (parentDir !== "") {
      setExpanded((current) => new Set([...current, parentDir]));
    }
  };

  const rows: Row[] = [];
  visibleRows(roots, expanded, editing, "", 0, rows);

  const run = (action: () => void) => () => {
    setMenu(null);
    action();
  };

  return (
    <SidebarMenu aria-label="Folders" role="tree">
      {rows.map((row) => {
        if (row.kind === "editor") {
          const parent = editing?.mode === "create" ? editing.parentDir : "";
          return (
            <li key="create-editor" role="none">
              <InlineNameInput
                initialValue=""
                depth={row.depth}
                onCommit={(name) => {
                  commitCreate(parent, name);
                }}
                onCancel={() => {
                  setEditing(null);
                }}
              />
            </li>
          );
        }
        const { node } = row;
        if (editing?.mode === "rename" && editing.path === node.path) {
          return (
            <li key={node.path} role="none">
              <InlineNameInput
                initialValue={basenamePath(node.path)}
                depth={row.depth}
                onCommit={(name) => {
                  commitRename(node.path, name);
                }}
                onCancel={() => {
                  setEditing(null);
                }}
              />
            </li>
          );
        }
        const isOpen = expanded.has(node.path);
        const active = activeFolder === node.path;
        const menuOpen = menu?.node.path === node.path;
        return (
          <SidebarMenuItem key={node.path} role="none">
            <SidebarMenuButton
              role="treeitem"
              aria-level={row.depth + 1}
              {...(node.children.length > 0 ? { "aria-expanded": isOpen } : {})}
              data-folder={node.path}
              draggable
              isActive={active}
              className={cn("pr-8", dropDir === node.path && "bg-primary/10 text-foreground")}
              style={{ paddingLeft: row.depth * 12 + 4 }}
              onClick={() => {
                onScope({ kind: "folder", path: node.path });
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" && !isOpen && node.children.length > 0) {
                  event.preventDefault();
                  toggle(node.path);
                } else if (event.key === "ArrowLeft" && isOpen) {
                  event.preventDefault();
                  toggle(node.path);
                } else if (event.key === "F2") {
                  event.preventDefault();
                  setEditing({ mode: "rename", path: node.path });
                }
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", node.path);
                startInternalDrag([node.path]);
              }}
              onDragEnd={endInternalDrag}
              onDragOver={(event) => {
                onDragOver(event, node.path);
              }}
              onDragLeave={() => {
                setDropDir((current) => (current === node.path ? null : current));
              }}
              onDrop={(event) => {
                onDrop(event, node.path);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ anchor: event.currentTarget, node });
              }}
            >
              {node.children.length > 0 ? (
                <ChevronRightIcon
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    isOpen && "rotate-90",
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(node.path);
                  }}
                />
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{basenamePath(node.path)}</span>
              <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
                {formatCount(node.items)}
              </span>
            </SidebarMenuButton>
            <SidebarMenuAction
              showOnHover
              tabIndex={-1}
              aria-label={`Actions for ${basenamePath(node.path)}`}
              {...(menuOpen ? { "data-popup-open": "" } : {})}
              onClick={(event) => {
                setMenu({ anchor: event.currentTarget, node });
              }}
            >
              <EllipsisIcon />
            </SidebarMenuAction>
          </SidebarMenuItem>
        );
      })}
      {rows.length === 0 ? (
        <li role="none">
          <p className="px-2 py-1 text-body text-muted-foreground">No folders yet.</p>
        </li>
      ) : null}
      <DropdownMenu
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMenu(null);
          }
        }}
      >
        {menu === null ? null : (
          <DropdownMenuContent anchor={menu.anchor} align="start" side="bottom">
            <DropdownMenuItem
              onClick={run(() => {
                onNewNoteIn(menu.node.path);
              })}
            >
              New note here
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={run(() => {
                setEditing({ mode: "create", parentDir: menu.node.path });
              })}
            >
              New folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={run(() => {
                setEditing({ mode: "rename", path: menu.node.path });
              })}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={run(() => {
                onMoveRequest([menu.node.path]);
              })}
            >
              Move to…
            </DropdownMenuItem>
            {ops.revealEntry === undefined ? null : (
              <DropdownMenuItem
                onClick={run(() => {
                  ops.revealEntry?.(menu.node.path);
                })}
              >
                Reveal in Finder
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={run(() => {
                ops.removeFolder(menu.node.path);
              })}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>
    </SidebarMenu>
  );
};
