import { describe, expect, it } from "vitest";

import { planMove, scopeAfterMove } from "./tree-ops";

describe("where a move may land", () => {
  it("names the destination path under the folder", () => {
    expect(planMove("a/x.md", "b")).toEqual({ ok: true, to: "b/x.md" });
    expect(planMove("a/x.md", "")).toEqual({ ok: true, to: "x.md" });
    expect(planMove("a", "b/c")).toEqual({ ok: true, to: "b/c/a" });
  });

  it("refuses a folder dropped on itself or inside itself", () => {
    expect(planMove("a", "a")).toEqual({ ok: false, reason: "self" });
    expect(planMove("a", "a/b")).toEqual({ ok: false, reason: "descendant" });
  });

  it("refuses the folder the entry is already in", () => {
    expect(planMove("a/x.md", "a")).toEqual({ ok: false, reason: "same-parent" });
    expect(planMove("x.md", "")).toEqual({ ok: false, reason: "same-parent" });
  });

  it("is not fooled by a folder whose name is a prefix", () => {
    expect(planMove("a", "ab").ok).toBe(true);
  });
});

describe("the folder the grid shows, after a folder moves", () => {
  it("follows a rename or a move of it, or of a folder above it", () => {
    expect(scopeAfterMove({ kind: "folder", path: "Reading" }, "Reading", "Articles")).toEqual({
      kind: "folder",
      path: "Articles",
    });
    expect(
      scopeAfterMove({ kind: "folder", path: "Reading/Long" }, "Reading", "Archive/Reading"),
    ).toEqual({ kind: "folder", path: "Archive/Reading/Long" });
  });

  it("leaves every other scope where it was", () => {
    expect(scopeAfterMove({ kind: "folder", path: "Readings" }, "Reading", "Articles")).toBeNull();
    expect(scopeAfterMove({ kind: "all" }, "Reading", "Articles")).toBeNull();
    expect(scopeAfterMove({ kind: "tag", tag: "reading" }, "Reading", "Articles")).toBeNull();
  });
});
