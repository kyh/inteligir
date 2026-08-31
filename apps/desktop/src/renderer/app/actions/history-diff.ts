// What restoring a revision WOULD change, as rows a list can render.
//
// The diff runs current → revision deliberately: the question this answers is
// "what happens if I press Restore", so removed lines are what the note holds
// now and added lines are what it would hold.
//
// Lines are `splitLinesLf`'s, byte-faithfully — the empty final segment of a
// newline-terminated file included. Trimming it would call two files identical
// when their bytes differ, which is the one thing a restore surface may not do.

import { diffLines, splitLinesLf, type DiffHunk } from "@repo/notes/text/line-diff";

/** Every row carries the LINE it came from as its id — the note's own line for
 *  a context or removed row, the revision's for an added one. */
export type DiffRow = { id: string } & (
  | { kind: "context"; text: string }
  | { kind: "removed"; text: string }
  | { kind: "added"; text: string }
  /** Unchanged lines elided between two hunks. */
  | { kind: "gap"; lines: number }
  /** Rows past the cap, not rendered. */
  | { kind: "truncated"; lines: number }
);

/** Unchanged lines kept on each side of a hunk, so a change reads in place. */
const CONTEXT_LINES = 2;

/**
 * Past this many lines the Myers walk is the cost rather than the answer: it
 * clones its frontier once per round, so two long notes sharing nothing runs
 * to hundreds of megabytes and a second of blocked paint. Beyond it the whole
 * file is reported replaced, which is what such a pair is anyway.
 */
const DIFF_LINE_BUDGET = 4_000;

/** A reader has the answer long before the four hundredth row, and every row
 *  is a wrapped `whitespace-pre-wrap` box the browser has to lay out. */
const MAX_DIFF_ROWS = 400;

/**
 * The rows, or an empty array when the two texts are byte-identical — which
 * the caller renders as its own statement rather than as an empty diff.
 */
export function diffRows(current: string, revision: string): DiffRow[] {
  if (current === revision) {
    return [];
  }
  const currentLines = splitLinesLf(current);
  const revisionLines = splitLinesLf(revision);
  const overBudget = currentLines.length + revisionLines.length > DIFF_LINE_BUDGET;
  const hunks: readonly DiffHunk[] = overBudget
    ? [{ baseStart: 0, baseEnd: currentLines.length, sideStart: 0, sideEnd: revisionLines.length }]
    : diffLines(currentLines, revisionLines);

  const rows: DiffRow[] = [];
  const push = (
    kind: "context" | "removed" | "added",
    prefix: string,
    lines: readonly string[],
    from: number,
    to: number,
  ): void => {
    for (let line = from; line < to; line += 1) {
      rows.push({ id: `${prefix}${String(line)}`, kind, text: lines[line] ?? "" });
    }
  };

  let emitted = 0;
  for (const [position, hunk] of hunks.entries()) {
    const from = Math.max(emitted, hunk.baseStart - CONTEXT_LINES);
    if (from > emitted) {
      rows.push({ id: `~${String(emitted)}`, kind: "gap", lines: from - emitted });
    }
    push("context", "c", currentLines, from, hunk.baseStart);
    push("removed", "-", currentLines, hunk.baseStart, hunk.baseEnd);
    push("added", "+", revisionLines, hunk.sideStart, hunk.sideEnd);
    // Trailing context stops where the NEXT hunk begins, or the same base line
    // is emitted twice — once as context and again as removed — and its row id
    // collides with itself.
    const nextHunkStart = hunks[position + 1]?.baseStart ?? currentLines.length;
    const to = Math.min(currentLines.length, hunk.baseEnd + CONTEXT_LINES, nextHunkStart);
    push("context", "c", currentLines, hunk.baseEnd, to);
    emitted = to;
  }
  if (emitted < currentLines.length) {
    rows.push({ id: `~${String(emitted)}`, kind: "gap", lines: currentLines.length - emitted });
  }
  if (rows.length > MAX_DIFF_ROWS) {
    return [
      ...rows.slice(0, MAX_DIFF_ROWS),
      { id: "truncated", kind: "truncated", lines: rows.length - MAX_DIFF_ROWS },
    ];
  }
  return rows;
}
