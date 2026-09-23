import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { listedNotePaths, searchNotesByFilename } from "../note-search";

const FILES = ["Welcome.md", "notes/ideas.md", "notes/daily/2026-08-16.md", "projects/plan.md"];

describe("the palette's note paths", () => {
  it("names the notes the rail lists, and nothing else the tree carries", () => {
    const entries: readonly VaultEntry[] = [
      { kind: "file", path: "notes/plans.comments.json" },
      { kind: "file", path: "notes/plans.md" },
      { kind: "dir", path: "notes" },
      { kind: "file", path: "assets/diagram.png" },
      { kind: "file", path: "archive/old.md" },
      { kind: "dir", path: ".trash" },
      { kind: "file", path: ".trash/old.md" },
    ];
    expect(listedNotePaths(entries)).toEqual(["notes/plans.md", "archive/old.md"]);
  });
});

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

  it("leaves a tag query to the index rather than fuzzy-matching its own text", () => {
    // "tag:plans" reaches `notes/tagging.md` as a subsequence
    expect(searchNotesByFilename("tag:plans", ["notes/tagging.md"])).toEqual([]);
  });
});
