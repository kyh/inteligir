import { describe, expect, it } from "vitest";
import { diffLines, splitLinesLf } from "../text/line-diff";
import type { DiffHunk, DiffLinesOptions } from "../text/line-diff";

const apply = (
  base: readonly string[],
  side: readonly string[],
  hunks: readonly DiffHunk[],
): string[] => {
  const out: string[] = [];
  let at = 0;
  for (const hunk of hunks) {
    out.push(...base.slice(at, hunk.baseStart), ...side.slice(hunk.sideStart, hunk.sideEnd));
    at = hunk.baseEnd;
  }
  out.push(...base.slice(at));
  return out;
};

const expectTrueDiff = (
  base: readonly string[],
  side: readonly string[],
  hunks: readonly DiffHunk[],
): void => {
  expect(apply(base, side, hunks)).toEqual(side);
  for (let i = 1; i < hunks.length; i += 1) {
    const prev = hunks[i - 1];
    const next = hunks[i];
    if (prev && next) {
      expect(next.baseStart).toBeGreaterThan(prev.baseEnd);
    }
  }
};

const roundTrips = (baseText: string, sideText: string): void => {
  const base = splitLinesLf(baseText);
  const side = splitLinesLf(sideText);
  expectTrueDiff(base, side, diffLines(base, side).hunks);
};

const editCount = (hunks: readonly DiffHunk[]): number =>
  hunks.reduce(
    (sum, hunk) => sum + (hunk.baseEnd - hunk.baseStart) + (hunk.sideEnd - hunk.sideStart),
    0,
  );

// the independent oracle for minimality: a Myers walk is shortest iff it deletes and inserts
// exactly the lines outside a longest common subsequence.
const shortestEditCount = (a: readonly string[], b: readonly string[]): number => {
  let previous = Array.from({ length: b.length + 1 }, () => 0);
  for (const line of a) {
    const row = [0];
    for (const [j, other] of b.entries()) {
      row.push(
        line === other ? (previous[j] ?? 0) + 1 : Math.max(previous[j + 1] ?? 0, row[j] ?? 0),
      );
    }
    previous = row;
  }
  return a.length + b.length - 2 * (previous[b.length] ?? 0);
};

// a fixed-seed Lehmer generator, so every run draws the same cases.
const seededLines = (seed: number) => {
  let state = seed;
  const next = (bound: number): number => {
    state = (state * 48_271) % 2_147_483_647;
    return state % bound;
  };
  return (): string[] => Array.from({ length: next(9) }, () => "abc".charAt(next(3)));
};

const distinctLines = (count: number, label: string): string[] =>
  Array.from({ length: count }, (_, index) => `${label} ${String(index)}`);

const within = (maxEditDistance: number): DiffLinesOptions => ({ maxEditDistance });

describe("diffLines", () => {
  it("answers no hunks for identical input", () => {
    expect(diffLines(["a", "b"], ["a", "b"])).toEqual({ hunks: [], kind: "minimal" });
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
    const { hunks } = diffLines(["a", "b", "c"], ["a", "B", "c"]);
    expect(hunks).toEqual([{ baseEnd: 2, baseStart: 1, sideEnd: 2, sideStart: 1 }]);
  });

  // the hunks the walk answered before its trace was cut to the live diagonals.
  it.each<[string[], string[], DiffHunk[]]>([
    [
      ["x", "y"],
      ["y", "x"],
      [
        { baseEnd: 1, baseStart: 0, sideEnd: 0, sideStart: 0 },
        { baseEnd: 2, baseStart: 2, sideEnd: 2, sideStart: 1 },
      ],
    ],
    [
      ["a", "a"],
      ["b", "a", "b", "a"],
      [
        { baseEnd: 0, baseStart: 0, sideEnd: 1, sideStart: 0 },
        { baseEnd: 1, baseStart: 1, sideEnd: 3, sideStart: 2 },
      ],
    ],
    [
      ["a", "b", "c", "a", "b", "b", "a"],
      ["c", "b", "a", "b", "a", "c"],
      [
        { baseEnd: 2, baseStart: 0, sideEnd: 0, sideStart: 0 },
        { baseEnd: 3, baseStart: 3, sideEnd: 2, sideStart: 1 },
        { baseEnd: 6, baseStart: 5, sideEnd: 4, sideStart: 4 },
        { baseEnd: 7, baseStart: 7, sideEnd: 6, sideStart: 5 },
      ],
    ],
    [
      ["", "a", "", "b", "", "c", ""],
      ["", "b", "", "", "a", "", "c"],
      [
        { baseEnd: 3, baseStart: 1, sideEnd: 1, sideStart: 1 },
        { baseEnd: 6, baseStart: 5, sideEnd: 3, sideStart: 3 },
        { baseEnd: 7, baseStart: 7, sideEnd: 7, sideStart: 4 },
      ],
    ],
  ])("breaks ties as it always has: %j against %j", (base, side, expected) => {
    expect(diffLines(base, side)).toEqual({ hunks: expected, kind: "minimal" });
  });

  it("answers a shortest true diff for every small input", () => {
    const draw = seededLines(7);
    for (let round = 0; round < 2000; round += 1) {
      const base = draw();
      const side = draw();
      const diff = diffLines(base, side);
      expect(diff.kind).toBe("minimal");
      expectTrueDiff(base, side, diff.hunks);
      expect(editCount(diff.hunks)).toBe(shortestEditCount(base, side));
    }
  });
});

describe("the edit budget", () => {
  it("walks an input exactly at the budget and gives up one edit past it", () => {
    expect(diffLines(["a", "b"], ["x", "y"], within(4)).kind).toBe("minimal");
    expect(diffLines(["a", "b"], ["x", "y"], within(3)).kind).toBe("overBudget");
  });

  it("answers one hunk over the span between the shared ends once the budget is passed", () => {
    const base = ["head", "a", "keep", "b", "tail"];
    const side = ["head", "A", "keep", "B", "tail"];
    const diff = diffLines(base, side, within(3));
    expect(diff).toEqual({
      hunks: [{ baseEnd: 4, baseStart: 1, sideEnd: 4, sideStart: 1 }],
      kind: "overBudget",
    });
    expectTrueDiff(base, side, diff.hunks);
  });

  it("gives up on two long notes that share nothing without walking them", () => {
    const base = distinctLines(5000, "old");
    const side = distinctLines(5000, "new");
    const diff = diffLines(base, side);
    expect(diff).toEqual({
      hunks: [{ baseEnd: 5000, baseStart: 0, sideEnd: 5000, sideStart: 0 }],
      kind: "overBudget",
    });
  });

  // the package's suites run under a heap ceiling (vitest.config.ts): a trace that copied the
  // whole frontier every round would need over a gigabyte here.
  it("walks 20k lines with a thousand scattered edits inside the heap ceiling", () => {
    const base = distinctLines(20_000, "line");
    const side = base.map((line, index) => (index % 20 === 10 ? `${line} edited` : line));
    const diff = diffLines(base, side);
    expect(diff.kind).toBe("minimal");
    expect(diff.hunks).toHaveLength(1000);
    expectTrueDiff(base, side, diff.hunks);
  });
});
