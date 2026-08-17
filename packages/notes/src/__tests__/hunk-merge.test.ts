import { describe, expect, it } from "vitest";
import { contentHunks, mergeHunks } from "../text/hunk-merge";

const BASE = ["alpha", "beta", "gamma", "delta", "epsilon"].join("\n");
const PROPOSED = ["alpha", "BETA", "gamma", "delta", "EPSILON", "zeta"].join("\n");

describe("contentHunks", () => {
  it("finds one region per maximal run the proposal rewrote", () => {
    const hunks = contentHunks(BASE, PROPOSED);
    expect(hunks.map((hunk) => [hunk.baseStart, hunk.baseEnd])).toEqual([
      [1, 2],
      [4, 5],
    ]);
    expect(hunks[0]?.baseLines).toEqual(["beta"]);
    expect(hunks[0]?.proposedLines).toEqual(["BETA"]);
    expect(hunks[1]?.proposedLines).toEqual(["EPSILON", "zeta"]);
  });

  it("indexes hunks by position, so a selection can name one", () => {
    expect(contentHunks(BASE, PROPOSED).map((hunk) => hunk.index)).toEqual([0, 1]);
  });

  it("reports nothing when the two sides agree", () => {
    expect(contentHunks(BASE, BASE)).toEqual([]);
  });

  it("treats a creation (empty base) as one whole-file hunk", () => {
    const hunks = contentHunks("", "# New\n\nbody\n");
    expect(hunks).toHaveLength(1);
    expect(mergeHunks("", "# New\n\nbody\n", new Set([0]))).toBe("# New\n\nbody\n");
  });
});

describe("mergeHunks", () => {
  it("takes exactly the selected regions and leaves the rest at base", () => {
    expect(mergeHunks(BASE, PROPOSED, new Set([0]))).toBe(
      ["alpha", "BETA", "gamma", "delta", "epsilon"].join("\n"),
    );
    expect(mergeHunks(BASE, PROPOSED, new Set([1]))).toBe(
      ["alpha", "beta", "gamma", "delta", "EPSILON", "zeta"].join("\n"),
    );
  });

  it("selecting nothing is the base; selecting everything is the proposal", () => {
    expect(mergeHunks(BASE, PROPOSED, new Set())).toBe(BASE);
    const every = new Set(contentHunks(BASE, PROPOSED).map((hunk) => hunk.index));
    expect(mergeHunks(BASE, PROPOSED, every)).toBe(PROPOSED);
  });

  it("preserves a trailing newline, which is a line of its own", () => {
    const base = "one\ntwo\n";
    const proposed = "one\nTWO\n";
    expect(mergeHunks(base, proposed, new Set([0]))).toBe(proposed);
  });

  it("is its own inverse with the sides swapped — how a reject is spelled", () => {
    // Accepting hunk 0 advances the base; rejecting hunk 1 retreats the
    // proposal. Both end with the pair agreeing on the region, so the derived
    // hunk list shrinks by one either way.
    const acceptedBase = mergeHunks(BASE, PROPOSED, new Set([0]));
    expect(contentHunks(acceptedBase, PROPOSED)).toHaveLength(1);

    const rejectedProposal = mergeHunks(PROPOSED, BASE, new Set([1]));
    expect(contentHunks(BASE, rejectedProposal)).toHaveLength(1);
    expect(contentHunks(BASE, rejectedProposal)[0]?.proposedLines).toEqual(["BETA"]);
  });

  it("empties the list when every hunk is resolved one at a time", () => {
    let base = BASE;
    for (;;) {
      const hunks = contentHunks(base, PROPOSED);
      const first = hunks[0];
      if (first === undefined) {
        break;
      }
      base = mergeHunks(base, PROPOSED, new Set([first.index]));
    }
    expect(base).toBe(PROPOSED);
  });
});
