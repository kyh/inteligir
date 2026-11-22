import { describe, expect, it } from "vitest";

import { folderPaths } from "./folder-paths";

const folder = (id: string, title: string, parentId: string | null) => ({
  id,
  kind: "folder" as const,
  parentId,
  title,
});

describe("the folder rows", () => {
  it("lists a parent before its children, siblings by title, each with its path", () => {
    const rows = folderPaths([
      folder("p", "Papers", "r"),
      folder("w", "Work", null),
      folder("r", "Reading", null),
      folder("b", "Books", "r"),
    ]);

    expect(rows.map((row) => [row.label, row.depth])).toStrictEqual([
      ["Reading", 0],
      ["Reading / Books", 1],
      ["Reading / Papers", 1],
      ["Work", 0],
    ]);
  });

  it("orders titles case aside, and folders before lists", () => {
    expect(
      folderPaths([
        { ...folder("l", "Alpha", null), kind: "list" },
        folder("a", "apple", null),
        folder("b", "Banana", null),
      ]).map((row) => row.label),
    ).toStrictEqual(["apple", "Banana", "Alpha"]);
  });

  it("shows a folder whose parent is not listed at the top", () => {
    expect(folderPaths([folder("x", "Lost", "gone")]).map((row) => row.label)).toStrictEqual([
      "Lost",
    ]);
  });
});
