// a turn's changes as the reply and the finish toast count them: its items, each move once at the
// path it made and no cover beside its item, while its paths stay every file its commits touched.

import { describe, expect, it } from "vitest";

import type { TurnCommit } from "../vault/git-history";
import { foldTurnCommits } from "./turn-changes";

const turnCommit = (sha: string, changes: TurnCommit["changes"]): TurnCommit => ({
  changes,
  parent: `${sha}^`,
  sha,
  trailers: { kind: "turn", threadId: "thr_1", turnId: "turn_1" },
});

describe("a turn's changes", () => {
  it("counts Tidy's moves as one item each, at the path each made", () => {
    const [turn] = foldTurnCommits([
      turnCommit("a1", [
        { path: "Reading/File over app.md", status: "A" },
        { path: "Unsorted/File over app.md", status: "D" },
        { path: "Recipes/Bread.md", status: "A" },
        { path: "Unsorted/Bread.md", status: "D" },
      ]),
    ]);
    expect(turn?.items).toEqual(["Reading/File over app.md", "Recipes/Bread.md"]);
    expect(turn?.paths).toHaveLength(4);
  });

  it("counts a saved link once, its cover riding with it, across the turn's commits", () => {
    const [turn] = foldTurnCommits([
      turnCommit("b1", [{ path: "Unsorted/site.test.md", status: "A" }]),
      turnCommit("b2", [
        { path: "Unsorted/site.test.md", status: "M" },
        { path: "assets/covers/0123456789abcdef.jpg", status: "A" },
      ]),
    ]);
    expect(turn?.items).toEqual(["Unsorted/site.test.md"]);
  });

  it("leaves out a file the turn made and removed again", () => {
    const [turn] = foldTurnCommits([
      turnCommit("c1", [
        { path: "Unsorted/draft.md", status: "A" },
        { path: "Plans.md", status: "M" },
      ]),
      turnCommit("c2", [{ path: "Unsorted/draft.md", status: "D" }]),
    ]);
    expect(turn?.items).toEqual(["Plans.md"]);
  });
});
