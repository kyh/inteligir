import { describe, expect, it } from "vitest";
import { parsePorcelain } from "../git-porcelain";

// git's framing: every entry NUL-terminated, so the split leaves a trailing empty token.
const porcelainBytes = (...entries: string[]): string =>
  entries.map((entry) => `${entry}\0`).join("");

describe("parsePorcelain", () => {
  it("reads the status columns and the path", () => {
    expect(parsePorcelain(porcelainBytes(" M notes/a.md", "?? untracked.md"))).toEqual([
      { origin: null, path: "notes/a.md", x: " ", y: "M" },
      { origin: null, path: "untracked.md", x: "?", y: "?" },
    ]);
  });

  it("leaves a path with spaces and tabs alone", () => {
    // without -z git C-quotes this name.
    expect(parsePorcelain(porcelainBytes(" M notes/a b\tc.md"))).toEqual([
      { origin: null, path: "notes/a b\tc.md", x: " ", y: "M" },
    ]);
  });

  it("takes a rename's origin from the token that follows it", () => {
    expect(
      parsePorcelain(porcelainBytes("R  notes/new.md", "notes/old.md", " M other.md")),
    ).toEqual([
      { origin: "notes/old.md", path: "notes/new.md", x: "R", y: " " },
      { origin: null, path: "other.md", x: " ", y: "M" },
    ]);
  });

  it("takes a copy's origin the same way, from either status column", () => {
    expect(parsePorcelain(porcelainBytes(" C notes/copy.md", "notes/source.md"))).toEqual([
      { origin: "notes/source.md", path: "notes/copy.md", x: " ", y: "C" },
    ]);
  });

  it("keeps unmerged entries, which is the conflict set", () => {
    expect(parsePorcelain(porcelainBytes("UU a.md", "AA b.md", "DD c.md", " M d.md"))).toEqual([
      { origin: null, path: "a.md", x: "U", y: "U" },
      { origin: null, path: "b.md", x: "A", y: "A" },
      { origin: null, path: "c.md", x: "D", y: "D" },
      { origin: null, path: "d.md", x: " ", y: "M" },
    ]);
  });

  it("reads a clean tree as no entries", () => {
    expect(parsePorcelain("")).toEqual([]);
  });
});
