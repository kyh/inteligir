// The external update path for a buffer the user may be sitting in: turn a
// whole-document replacement into per-hunk CodeMirror changes (via the shared
// Myers line diff), so a cursor in any unchanged region — including one
// BETWEEN two edits — keeps its exact position. The transaction is marked
// with the annotation below and kept out of undo history: Undo must never
// resurrect content the disk no longer holds.

import { Annotation, type ChangeSpec } from "@codemirror/state";
import { diffLines, splitLines } from "@repo/notes/text/line-diff";

/** Stamped on every transaction replaceDoc dispatches, so extensions can
 * tell an external content replacement from a user edit. */
export const externalReplaceAnnotation = Annotation.define<boolean>();

/**
 * Per-hunk change specs rewriting `current` into `next`. All offsets address
 * `current` (CodeMirror composes a multi-part change against the original
 * document). Line hunks are converted to character ranges segment-wise:
 * segments are `split("\n")` units, so a deletion or insertion has to claim
 * exactly one "\n" separator — from the left edge when it can (bs > 0), else
 * the right — and a replacement never touches separators at all.
 */
export function externalReplaceChanges(current: string, next: string): ChangeSpec[] {
  const base = splitLines(current);
  const side = splitLines(next);
  const offsets: number[] = [0];
  for (const segment of base) {
    offsets.push((offsets.at(-1) ?? 0) + segment.length + 1);
  }
  const startOf = (index: number): number => offsets[index] ?? 0;
  const endOf = (index: number): number => startOf(index) + (base[index]?.length ?? 0);

  const changes: ChangeSpec[] = [];
  for (const hunk of diffLines(base, side)) {
    const insert = side.slice(hunk.sideStart, hunk.sideEnd).join("\n");
    if (hunk.baseEnd > hunk.baseStart && hunk.sideEnd > hunk.sideStart) {
      changes.push({ from: startOf(hunk.baseStart), to: endOf(hunk.baseEnd - 1), insert });
    } else if (hunk.baseEnd > hunk.baseStart) {
      if (hunk.baseStart > 0) {
        changes.push({ from: endOf(hunk.baseStart - 1), to: endOf(hunk.baseEnd - 1) });
      } else if (hunk.baseEnd < base.length) {
        changes.push({ from: 0, to: startOf(hunk.baseEnd) });
      } else {
        changes.push({ from: 0, to: current.length });
      }
    } else if (hunk.baseStart < base.length) {
      changes.push({ from: startOf(hunk.baseStart), insert: `${insert}\n` });
    } else {
      changes.push({ from: current.length, insert: `\n${insert}` });
    }
  }
  return changes;
}
