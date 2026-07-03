import { describe, expect, it } from "vitest";

import { buildVaultTree, type VaultTreeNode } from "@repo/app/sidebar/vault-tree";
import type { VaultEntry } from "@repo/features/ipc-registry";

function doc(path: string): VaultEntry {
  return { path, name: path.split("/").pop() ?? path, kind: "doc" };
}

function names(nodes: VaultTreeNode[]): string[] {
  return nodes.map((n) => (n.type === "folder" ? `${n.name}/` : n.name));
}

describe("buildVaultTree", () => {
  it("returns a flat list for root-level files", () => {
    const tree = buildVaultTree([doc("b.md"), doc("a.md")]);
    expect(names(tree)).toEqual(["a.md", "b.md"]);
    expect(tree.every((n) => n.type === "file")).toBe(true);
  });

  it("nests files under their folders", () => {
    const tree = buildVaultTree([doc("projects/q3/plan.md"), doc("projects/notes.md")]);
    expect(names(tree)).toEqual(["projects/"]);
    const projects = tree[0];
    if (projects?.type !== "folder") throw new Error("expected projects folder");
    // Folders before files, both sorted.
    expect(names(projects.children)).toEqual(["q3/", "notes.md"]);
    const q3 = projects.children[0];
    if (q3?.type !== "folder") throw new Error("expected q3 folder");
    expect(q3.path).toBe("projects/q3");
    expect(names(q3.children)).toEqual(["plan.md"]);
  });

  it("sorts folders before files and case-insensitively", () => {
    const tree = buildVaultTree([doc("Zebra.md"), doc("alpha/one.md"), doc("apple.md")]);
    expect(names(tree)).toEqual(["alpha/", "apple.md", "Zebra.md"]);
  });

  it("carries kind through to file nodes", () => {
    const tree = buildVaultTree([{ path: "logo.png", name: "logo.png", kind: "other" }]);
    const file = tree[0];
    if (file?.type !== "file") throw new Error("expected file");
    expect(file.kind).toBe("other");
  });

  it("merges multiple files in the same nested folder", () => {
    const tree = buildVaultTree([doc("a/b/x.md"), doc("a/b/y.md"), doc("a/z.md")]);
    const a = tree[0];
    if (a?.type !== "folder") throw new Error("expected a/");
    expect(names(a.children)).toEqual(["b/", "z.md"]);
    const b = a.children[0];
    if (b?.type !== "folder") throw new Error("expected b/");
    expect(names(b.children)).toEqual(["x.md", "y.md"]);
  });
});
