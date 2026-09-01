// The one decoder of `git status --porcelain`, against the shapes the three
// hand-rolled readers it replaced disagreed about: a quoted path, a rename's
// origin, and the trailing empty token.

import { describe, expect, it } from "vitest";
import { parsePorcelain } from "../git-porcelain";

/** git's own framing: every entry NUL-terminated, so the split leaves a
 *  trailing empty token. */
function porcelainBytes(...entries: string[]): string {
  return entries.map((entry) => `${entry}\0`).join("");
}

describe("parsePorcelain", () => {
  it("reads the status columns and the path", () => {
    expect(parsePorcelain(porcelainBytes(" M notes/a.md", "?? untracked.md"))).toEqual([
      { x: " ", y: "M", path: "notes/a.md", origin: null },
      { x: "?", y: "?", path: "untracked.md", origin: null },
    ]);
  });

  it("leaves a path with spaces and tabs alone", () => {
    // The reason `-z` is the format rather than an option: without it git
    // C-QUOTES this name, and two of the three readers handed the quotes back
    // as part of the path.
    expect(parsePorcelain(porcelainBytes(" M notes/a b\tc.md"))).toEqual([
      { x: " ", y: "M", path: "notes/a b\tc.md", origin: null },
    ]);
  });

  it("takes a rename's origin from the token that follows it", () => {
    expect(
      parsePorcelain(porcelainBytes("R  notes/new.md", "notes/old.md", " M other.md")),
    ).toEqual([
      { x: "R", y: " ", path: "notes/new.md", origin: "notes/old.md" },
      { x: " ", y: "M", path: "other.md", origin: null },
    ]);
  });

  it("takes a copy's origin the same way, from either status column", () => {
    expect(parsePorcelain(porcelainBytes(" C notes/copy.md", "notes/source.md"))).toEqual([
      { x: " ", y: "C", path: "notes/copy.md", origin: "notes/source.md" },
    ]);
  });

  it("keeps unmerged entries, which is the conflict set", () => {
    expect(parsePorcelain(porcelainBytes("UU a.md", "AA b.md", "DD c.md", " M d.md"))).toEqual([
      { x: "U", y: "U", path: "a.md", origin: null },
      { x: "A", y: "A", path: "b.md", origin: null },
      { x: "D", y: "D", path: "c.md", origin: null },
      { x: " ", y: "M", path: "d.md", origin: null },
    ]);
  });

  it("reads a clean tree as no entries", () => {
    expect(parsePorcelain("")).toEqual([]);
  });
});
