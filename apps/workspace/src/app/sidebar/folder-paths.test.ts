import { describe, expect, it } from "vitest";

import { folderPaths } from "./folder-paths";

const folder = (id: string, name: string, parentId: string | null, sort = "a0") => ({
  id,
  name,
  parentId,
  sort,
});

describe("the folder rows", () => {
  it("lists a parent before its children, siblings by their order key, each with its path", () => {
    const rows = folderPaths([
      folder("p", "Papers", "r", "a0"),
      folder("w", "Work", null, "a1"),
      folder("r", "Reading", null, "a0"),
      folder("b", "Books", "r", "Zz"),
    ]);
    expect(rows.map((row) => [row.label, row.depth])).toStrictEqual([
      ["Reading", 0],
      ["Reading / Books", 1],
      ["Reading / Papers", 1],
      ["Work", 0],
    ]);
  });

  it("shows a folder whose parent is not listed at the top", () => {
    expect(folderPaths([folder("x", "Lost", "gone")]).map((row) => row.label)).toStrictEqual([
      "Lost",
    ]);
  });
});
