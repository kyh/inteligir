import { describe, expect, it } from "vitest";
import { diffLines, splitLinesLf, type DiffHunk } from "../text/line-diff";

function apply(base: readonly string[], side: readonly string[], hunks: DiffHunk[]): string[] {
  const out: string[] = [];
  let at = 0;
  for (const hunk of hunks) {
    out.push(...base.slice(at, hunk.baseStart));
    out.push(...side.slice(hunk.sideStart, hunk.sideEnd));
    at = hunk.baseEnd;
  }
  out.push(...base.slice(at));
  return out;
}

function roundTrips(baseText: string, sideText: string): void {
  const base = splitLinesLf(baseText);
  const side = splitLinesLf(sideText);
  const hunks = diffLines(base, side);
  expect(apply(base, side, hunks).join("\n")).toBe(sideText);
  for (let i = 1; i < hunks.length; i += 1) {
    const prev = hunks[i - 1];
    const next = hunks[i];
    if (prev && next) {
      expect(next.baseStart).toBeGreaterThan(prev.baseEnd);
    }
  }
}

describe("diffLines", () => {
  it("answers no hunks for identical input", () => {
    expect(diffLines(["a", "b"], ["a", "b"])).toEqual([]);
  });

  it("round-trips edits, inserts, deletes and rewrites", () => {
    roundTrips("a\nb\nc\n", "a\nB\nc\n");
    roundTrips("a\nb\nc\n", "a\nb\nx\nc\n");
    roundTrips("a\nb\nc\n", "a\nc\n");
    roundTrips("a\nb\nc\n", "x\ny\n");
    roundTrips("", "whole\nnew\n");
    roundTrips("gone\n", "");
    roundTrips("a\nb", "a\nb\n");
    roundTrips("a\nb\n", "a\nb");
  });

  it("keeps repeated lines aligned", () => {
    roundTrips("-\nitem\n-\nitem\n-\n", "-\nitem edited\n-\nitem\n-\nmore\n");
  });

  it("reports the minimal hunk for a single-line edit", () => {
    const hunks = diffLines(["a", "b", "c"], ["a", "B", "c"]);
    expect(hunks).toEqual([{ baseStart: 1, baseEnd: 2, sideStart: 1, sideEnd: 2 }]);
  });
});
