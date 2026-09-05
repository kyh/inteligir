import { describe, expect, it } from "vitest";

import { deleteSwallowsOpenNote, openNoteAfterRename, planMove } from "../tree-ops";

const OPEN = "notes/plans/weekly.md";

describe("what a tree rename means for the open note", () => {
  it("carries it under the folder's new name", () => {
    expect(openNoteAfterRename(OPEN, "notes/plans", "notes/roadmap")).toBe(
      "notes/roadmap/weekly.md",
    );
  });

  it("leaves a rename of the note itself to the session", () => {
    expect(openNoteAfterRename(OPEN, OPEN, "notes/plans/monthly.md")).toBeNull();
  });

  it("ignores a rename that does not contain it", () => {
    expect(openNoteAfterRename(OPEN, "archive", "old")).toBeNull();
    expect(openNoteAfterRename(null, "notes/plans", "notes/roadmap")).toBeNull();
  });

  it("is not fooled by a folder whose name is a prefix of the open one", () => {
    // "notes/plan" is not an ancestor of "notes/plans/weekly.md", and a bare
    // `startsWith` on the name alone says it is.
    expect(openNoteAfterRename(OPEN, "notes/plan", "notes/roadmap")).toBeNull();
  });
});

describe("what a tree delete means for the open note", () => {
  it("swallows it when the folder holds it", () => {
    expect(deleteSwallowsOpenNote(OPEN, "notes/plans")).toBe(true);
  });

  it("leaves the deletion of the note itself to the session", () => {
    expect(deleteSwallowsOpenNote(OPEN, OPEN)).toBe(false);
  });

  it("says nothing about a folder that does not hold it", () => {
    expect(deleteSwallowsOpenNote(OPEN, "notes/plan")).toBe(false);
    expect(deleteSwallowsOpenNote(OPEN, "archive")).toBe(false);
    expect(deleteSwallowsOpenNote(null, "notes/plans")).toBe(false);
  });
});

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
