import { describe, expect, it } from "vitest";

import { flattenTree, resolveTreeKey, type FlatRow } from "@renderer/sidebar/tree-navigation";
import type { VaultTreeNode } from "@renderer/sidebar/vault-tree";

function folder(path: string, children: VaultTreeNode[]): VaultTreeNode {
  const name = path.split("/").pop() ?? path;
  return { type: "folder", name, path, children };
}
function file(path: string): VaultTreeNode {
  const name = path.split("/").pop() ?? path;
  return { type: "file", name, path, kind: "doc" };
}

// projects/            (depth 0)
//   q3/                (depth 1)
//     plan.md          (depth 2)
//   notes.md           (depth 1)
// top.md               (depth 0)
const TREE: VaultTreeNode[] = [
  folder("projects", [
    folder("projects/q3", [file("projects/q3/plan.md")]),
    file("projects/notes.md"),
  ]),
  file("top.md"),
];

const paths = (rows: FlatRow[]) => rows.map((r) => r.node.path);

describe("flattenTree", () => {
  it("lists every row in order when nothing is collapsed", () => {
    const rows = flattenTree(TREE, new Set());
    expect(paths(rows)).toEqual([
      "projects",
      "projects/q3",
      "projects/q3/plan.md",
      "projects/notes.md",
      "top.md",
    ]);
  });

  it("tags depth, expanded, and parent", () => {
    const rows = flattenTree(TREE, new Set());
    const plan = rows.find((r) => r.node.path === "projects/q3/plan.md");
    expect(plan).toMatchObject({ depth: 2, expanded: false, parentPath: "projects/q3" });
    const q3 = rows.find((r) => r.node.path === "projects/q3");
    expect(q3).toMatchObject({ depth: 1, expanded: true, parentPath: "projects" });
  });

  it("hides descendants of a collapsed folder but keeps the folder row", () => {
    const rows = flattenTree(TREE, new Set(["projects/q3"]));
    expect(paths(rows)).toEqual(["projects", "projects/q3", "projects/notes.md", "top.md"]);
    expect(rows.find((r) => r.node.path === "projects/q3")?.expanded).toBe(false);
  });

  it("collapsing a top folder hides the whole subtree", () => {
    const rows = flattenTree(TREE, new Set(["projects"]));
    expect(paths(rows)).toEqual(["projects", "top.md"]);
  });
});

describe("resolveTreeKey", () => {
  const rows = flattenTree(TREE, new Set());

  it("focuses the first row when nothing is focused", () => {
    expect(resolveTreeKey(rows, null, "ArrowDown")).toEqual({ kind: "focus", path: "projects" });
    expect(resolveTreeKey(rows, null, "ArrowUp")).toEqual({ kind: "focus", path: "projects" });
  });

  it("ArrowDown/ArrowUp move across visible rows and clamp at the ends", () => {
    expect(resolveTreeKey(rows, "projects", "ArrowDown")).toEqual({
      kind: "focus",
      path: "projects/q3",
    });
    expect(resolveTreeKey(rows, "projects/q3", "ArrowUp")).toEqual({
      kind: "focus",
      path: "projects",
    });
    expect(resolveTreeKey(rows, "projects", "ArrowUp")).toBeNull();
    expect(resolveTreeKey(rows, "top.md", "ArrowDown")).toBeNull();
  });

  it("ArrowRight expands a collapsed folder", () => {
    const collapsed = flattenTree(TREE, new Set(["projects/q3"]));
    expect(resolveTreeKey(collapsed, "projects/q3", "ArrowRight")).toEqual({
      kind: "expand",
      path: "projects/q3",
    });
  });

  it("ArrowRight on an expanded folder steps to its first child", () => {
    expect(resolveTreeKey(rows, "projects", "ArrowRight")).toEqual({
      kind: "focus",
      path: "projects/q3",
    });
  });

  it("ArrowRight on a file does nothing", () => {
    expect(resolveTreeKey(rows, "top.md", "ArrowRight")).toBeNull();
  });

  it("ArrowLeft collapses an expanded folder", () => {
    expect(resolveTreeKey(rows, "projects", "ArrowLeft")).toEqual({
      kind: "collapse",
      path: "projects",
    });
  });

  it("ArrowLeft on a leaf steps to the parent folder", () => {
    expect(resolveTreeKey(rows, "projects/q3/plan.md", "ArrowLeft")).toEqual({
      kind: "focus",
      path: "projects/q3",
    });
    // A collapsed folder is a leaf for this purpose → move to parent.
    const collapsed = flattenTree(TREE, new Set(["projects/q3"]));
    expect(resolveTreeKey(collapsed, "projects/q3", "ArrowLeft")).toEqual({
      kind: "focus",
      path: "projects",
    });
  });

  it("ArrowLeft on a root leaf does nothing", () => {
    expect(resolveTreeKey(rows, "top.md", "ArrowLeft")).toBeNull();
  });

  it("Enter/Space activate the focused row", () => {
    expect(resolveTreeKey(rows, "top.md", "Enter")).toEqual({ kind: "activate", path: "top.md" });
    expect(resolveTreeKey(rows, "projects", " ")).toEqual({ kind: "activate", path: "projects" });
  });

  it("ignores unrelated keys and empty trees", () => {
    expect(resolveTreeKey(rows, "top.md", "a")).toBeNull();
    expect(resolveTreeKey([], null, "ArrowDown")).toBeNull();
  });
});
