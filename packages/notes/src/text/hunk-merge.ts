// Per-hunk selection over a (base, proposed) pair — the arithmetic behind a
// suggested edit's accept/reject buttons, shared verbatim by the server that
// applies a choice and the client that renders one.
//
// A hunk is one entry of the Myers walk beside this module: a maximal run of
// base lines the proposal rewrote. Selecting a subset is a single pass —
// stable base lines pass through, a selected hunk contributes the proposal's
// lines, an unselected one contributes the base's — so accepting a hunk and
// rejecting one are the same operation from opposite ends:
//
//   accept hunk i → the new BASE is `mergeHunks(base, proposed, [i])`
//                   (that region is on disk now, so the two sides agree there)
//   reject hunk i → the new PROPOSED is `mergeHunks(proposed, base, [i])`
//                   (the proposal gives that region back, same agreement)
//
// Which is why there is one function and not two: the hunk simply leaves the
// derived list either way, and a proposal whose list is empty is finished.

import { diffLines, splitLines } from "./line-diff";

/** One reviewable region: where it sits in the base, and what each side says. */
export interface ContentHunk {
  /** Position in the hunk list — what a caller names when it selects one. */
  index: number;
  /** Base line range, half-open, 0-based. A zero-width span is an insertion. */
  baseStart: number;
  baseEnd: number;
  baseLines: string[];
  proposedLines: string[];
}

export function contentHunks(base: string, proposed: string): ContentHunk[] {
  const baseLines = splitLines(base);
  const proposedLines = splitLines(proposed);
  return diffLines(baseLines, proposedLines).map((hunk, index) => ({
    index,
    baseStart: hunk.baseStart,
    baseEnd: hunk.baseEnd,
    baseLines: baseLines.slice(hunk.baseStart, hunk.baseEnd),
    proposedLines: proposedLines.slice(hunk.sideStart, hunk.sideEnd),
  }));
}

/**
 * `base` with the selected hunks replaced by `proposed`'s lines. `selected`
 * indexes the list `contentHunks(base, proposed)` returns — so a caller that
 * derived its indices from a different pair gets a different answer, which is
 * why every wire verb names the revision it derived them from.
 */
export function mergeHunks(base: string, proposed: string, selected: ReadonlySet<number>): string {
  const baseLines = splitLines(base);
  const proposedLines = splitLines(proposed);
  const hunks = diffLines(baseLines, proposedLines);
  const merged: string[] = [];
  let baseLine = 0;
  for (const [index, hunk] of hunks.entries()) {
    merged.push(...baseLines.slice(baseLine, hunk.baseStart));
    merged.push(
      ...(selected.has(index)
        ? proposedLines.slice(hunk.sideStart, hunk.sideEnd)
        : baseLines.slice(hunk.baseStart, hunk.baseEnd)),
    );
    baseLine = hunk.baseEnd;
  }
  merged.push(...baseLines.slice(baseLine));
  return merged.join("\n");
}
