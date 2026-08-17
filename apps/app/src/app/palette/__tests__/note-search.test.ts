import { describe, expect, it } from "vitest";
import { searchNotesByFilename } from "../note-search";

const FILES = ["Welcome.md", "notes/ideas.md", "notes/daily/2026-08-16.md", "projects/plan.md"];

describe("the filename tiers", () => {
  it("lists alphabetically on an empty query", () => {
    const hits = searchNotesByFilename("", FILES);
    expect(hits[0]?.path).toBe("Welcome.md");
    expect(hits).toHaveLength(4);
  });

  it("ranks name-prefix above path matches", () => {
    const hits = searchNotesByFilename("plan", FILES);
    expect(hits[0]?.path).toBe("projects/plan.md");
  });

  it("matches loosely as a path subsequence", () => {
    const hits = searchNotesByFilename("nids", FILES);
    expect(hits.map((hit) => hit.path)).toContain("notes/ideas.md");
  });

  it("answers nothing for a query nothing matches", () => {
    expect(searchNotesByFilename("zzzz", FILES)).toEqual([]);
  });
});
