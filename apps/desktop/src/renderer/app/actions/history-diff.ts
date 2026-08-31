// What restoring a revision WOULD change, as rows a list can render.
//
// The diff runs current → revision deliberately, not the other way round: the
// question the History tab answers is "what happens if I press Restore", so
// removed lines are what the note holds now and added lines are what it would
// hold. Reversing it would render a true diff that answers a question nobody
// asked.
//
// Lines are `splitLinesLf`'s, byte-faithfully — including the empty final
// segment a newline-terminated file ends with. A view that trimmed it would
// call two files identical when their bytes differ, which is the one thing a
// restore surface may not do.

import { diffLines, splitLinesLf } from "@repo/notes/text/line-diff";

/** Every row carries the LINE it came from as its id — the note's own line for
 *  a context/removed row, the revision's for an added one — so a list key is
 *  the row's identity rather than its position in the array. */
export type DiffRow = { id: string } & (
  | { kind: "context"; text: string }
  | { kind: "removed"; text: string }
  | { kind: "added"; text: string }
  /** Unchanged lines elided between two hunks. */
  | { kind: "gap"; lines: number }
);

/** Unchanged lines kept on each side of a hunk, so a change reads in place. */
const CONTEXT_LINES = 2;

/**
 * The rows, or an empty array when the two texts are byte-identical — which
 * the caller renders as "this revision matches the note on disk" rather than
 * as an empty diff.
 */
export function diffRows(current: string, revision: string): DiffRow[] {
  const currentLines = splitLinesLf(current);
  const revisionLines = splitLinesLf(revision);
  const hunks = diffLines(currentLines, revisionLines);
  if (hunks.length === 0) {
    return [];
  }

  const rows: DiffRow[] = [];
  let emitted = 0;
  for (const hunk of hunks) {
    const from = Math.max(emitted, hunk.baseStart - CONTEXT_LINES);
    if (from > emitted) {
      rows.push({ id: `~${String(emitted)}`, kind: "gap", lines: from - emitted });
    }
    for (let line = from; line < hunk.baseStart; line += 1) {
      rows.push({ id: `c${String(line)}`, kind: "context", text: currentLines[line] ?? "" });
    }
    for (let line = hunk.baseStart; line < hunk.baseEnd; line += 1) {
      rows.push({ id: `-${String(line)}`, kind: "removed", text: currentLines[line] ?? "" });
    }
    for (let line = hunk.sideStart; line < hunk.sideEnd; line += 1) {
      rows.push({ id: `+${String(line)}`, kind: "added", text: revisionLines[line] ?? "" });
    }
    const to = Math.min(currentLines.length, hunk.baseEnd + CONTEXT_LINES);
    for (let line = hunk.baseEnd; line < to; line += 1) {
      rows.push({ id: `c${String(line)}`, kind: "context", text: currentLines[line] ?? "" });
    }
    emitted = to;
  }
  if (emitted < currentLines.length) {
    rows.push({
      id: `~${String(emitted)}`,
      kind: "gap",
      lines: currentLines.length - emitted,
    });
  }
  return rows;
}
