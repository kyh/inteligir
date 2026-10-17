import { describe, expect, it } from "vitest";

import { turnItemPaths } from "../turn-items";

describe("the items a turn changed", () => {
  it("counts a move once, at the path it made", () => {
    expect(
      turnItemPaths([
        { change: "added", path: "Reading/File over app.md" },
        { change: "deleted", path: "Unsorted/File over app.md" },
        { change: "added", path: "Recipes/Bread.md" },
        { change: "deleted", path: "Unsorted/Bread.md" },
      ]),
    ).toEqual(["Reading/File over app.md", "Recipes/Bread.md"]);
  });

  it("lets a cover, an original and a page copy ride the item beside them", () => {
    expect(
      turnItemPaths([
        { change: "added", path: "Unsorted/File over app.md" },
        { change: "added", path: "assets/covers/0123456789abcdef.jpg" },
        { change: "added", path: "assets/pages/fedcba9876543210.html" },
        { change: "added", path: ".inteligir/annotations/abc.json" },
      ]),
    ).toEqual(["Unsorted/File over app.md"]);
  });

  it("names the files of a turn that changed files alone", () => {
    expect(turnItemPaths([{ change: "modified", path: "assets/shot.png" }])).toEqual([
      "assets/shot.png",
    ]);
  });

  it("keeps a removal and a new item that share no name as two", () => {
    expect(
      turnItemPaths([
        { change: "deleted", path: "Unsorted/Old.md" },
        { change: "added", path: "Unsorted/New.md" },
        { change: "modified", path: "Reading/Old.md" },
      ]),
    ).toEqual(["Unsorted/Old.md", "Unsorted/New.md", "Reading/Old.md"]);
  });

  it("folds the two ends of a move when the change is unknown, as an undo answers them", () => {
    expect(
      turnItemPaths([
        { change: null, path: "Unsorted/Bread.md" },
        { change: null, path: "Recipes/Bread.md" },
        { change: null, path: "Plans.md" },
      ]),
    ).toEqual(["Unsorted/Bread.md", "Plans.md"]);
  });
});
