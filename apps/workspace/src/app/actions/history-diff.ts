// runs current → revision: removed rows are what the note holds now. the empty final
// segment of a newline-terminated file is kept, or two files with different bytes read identical.

import { diffLines, splitLinesLf } from "@repo/notes/text/line-diff";

export type DiffRow = { id: string } & (
  | { kind: "context"; text: string }
  | { kind: "removed"; text: string }
  | { kind: "added"; text: string }
  | { kind: "gap"; lines: number }
  | { kind: "truncated"; lines: number }
  | { kind: "unaligned" }
);

const CONTEXT_LINES = 2;

const MAX_DIFF_ROWS = 400;

export const diffRows = (current: string, revision: string): DiffRow[] => {
  if (current === revision) {
    return [];
  }
  const currentLines = splitLinesLf(current);
  const revisionLines = splitLinesLf(revision);
  const diff = diffLines(currentLines, revisionLines);
  const { hunks } = diff;

  // past the diff's budget the whole span is one hunk, which reads as every line rewritten.
  const rows: DiffRow[] =
    diff.kind === "overBudget" ? [{ id: "unaligned", kind: "unaligned" }] : [];
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
    // clamped at the next hunk, or one base line is emitted as context and as removed under one id.
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
};
