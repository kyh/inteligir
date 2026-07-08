// Pure keyboard-navigation model for the sidebar file tree, extracted so the
// VS Code / Zed tree semantics can be unit-tested without a DOM. The tree is
// rendered FLAT (one full-width row per visible node); this module owns two
// pure pieces:
//   - flattenTree: nested tree + collapsed-set → the ordered list of VISIBLE
//     rows (a collapsed folder hides its subtree), each tagged with depth,
//     parent, and expanded state.
//   - resolveTreeKey: (rows, focused, key) → the command a keypress implies.
// The component layer applies the command (move DOM focus / toggle collapse /
// open a file); it holds no navigation logic of its own.

import type { VaultTreeNode } from "@renderer/sidebar/vault-tree";

export type FlatRow = {
  node: VaultTreeNode;
  /** 0 for a root-level row; +1 per nesting level. */
  depth: number;
  /** Folders: whether currently expanded. Files: always false. */
  expanded: boolean;
  /** Path of the containing folder, or null at the root. */
  parentPath: string | null;
};

/** The effect a keypress should have. The component maps this onto DOM focus /
 * collapse-set / open actions; there is no other tree behavior. */
export type TreeCommand =
  | { kind: "focus"; path: string }
  | { kind: "expand"; path: string }
  | { kind: "collapse"; path: string }
  | { kind: "activate"; path: string };

/** Flatten the nested tree into the ordered list of currently-visible rows.
 * A folder whose path is in `collapsed` contributes its own row but none of
 * its descendants. Order matches render order (folders-before-files is already
 * baked into the tree). */
export function flattenTree(
  nodes: readonly VaultTreeNode[],
  collapsed: ReadonlySet<string>,
): FlatRow[] {
  const rows: FlatRow[] = [];

  const walk = (list: readonly VaultTreeNode[], depth: number, parentPath: string | null) => {
    for (const node of list) {
      if (node.type === "file") {
        rows.push({ node, depth, expanded: false, parentPath });
        continue;
      }
      const expanded = !collapsed.has(node.path);
      rows.push({ node, depth, expanded, parentPath });
      if (expanded) walk(node.children, depth + 1, node.path);
    }
  };

  walk(nodes, 0, null);
  return rows;
}

/** Resolve a keypress against the visible rows and current focus. Returns null
 * when the key isn't a tree key or the move has no target (e.g. ArrowUp on the
 * first row). Keys handled: ArrowDown/Up (roving focus across visible rows),
 * ArrowRight (expand a collapsed folder, else step to first child),
 * ArrowLeft (collapse an open folder, else step to parent), Enter/Space
 * (activate: open a file / toggle a folder). */
export function resolveTreeKey(
  rows: readonly FlatRow[],
  focusedPath: string | null,
  key: string,
): TreeCommand | null {
  const first = rows[0];
  if (!first) return null;

  const index = rows.findIndex((r) => r.node.path === focusedPath);
  const current = index === -1 ? null : rows[index];

  switch (key) {
    case "ArrowDown": {
      if (!current) return { kind: "focus", path: first.node.path };
      const next = rows[index + 1];
      return next ? { kind: "focus", path: next.node.path } : null;
    }
    case "ArrowUp": {
      if (!current) return { kind: "focus", path: first.node.path };
      const prev = rows[index - 1];
      return prev ? { kind: "focus", path: prev.node.path } : null;
    }
    case "ArrowRight": {
      if (!current) return null;
      if (current.node.type !== "folder") return null;
      if (!current.expanded) return { kind: "expand", path: current.node.path };
      // Expanded folder: the next row is its first child (folders always hold
      // children — empty folders never enter the tree).
      const next = rows[index + 1];
      return next && next.parentPath === current.node.path
        ? { kind: "focus", path: next.node.path }
        : null;
    }
    case "ArrowLeft": {
      if (!current) return null;
      if (current.node.type === "folder" && current.expanded)
        return { kind: "collapse", path: current.node.path };
      return current.parentPath ? { kind: "focus", path: current.parentPath } : null;
    }
    case "Enter":
    case " ":
      return current ? { kind: "activate", path: current.node.path } : null;
    default:
      return null;
  }
}
