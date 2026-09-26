// a genuine overlap keeps mine (the buffer is the user's work) and reports the conflict. `union`
// keeps both sides' lines there instead, mine first, for a file every writer only appends to.
// unstable regions not separated by a stable line are grouped, as classic diff3 does.
// a side past the line diff's budget arrives as one hunk, so the other side's edits inside it
// are overlaps and conflict, while its edits outside it still merge.

import { diffLines, splitLinesLf } from "./line-diff";
import type { DiffHunk } from "./line-diff";

export interface Diff3Result {
  merged: string;
  // an overlap was met, whichever policy resolved it
  conflicted: boolean;
}

export type Diff3Overlap = "mine" | "union";

export interface Diff3Options {
  readonly overlap?: Diff3Overlap;
}

interface SideCursor {
  hunks: readonly DiffHunk[];
  index: number;
  sideLine: number;
}

interface RegionHunks {
  mine: DiffHunk[];
  theirs: DiffHunk[];
}

// element-wise, never joined strings: segmentation participates in equality.
const segmentsEqual = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
};

// the lines both segments share appear once, in order, with mine's own lines before theirs
// between them: two appends keep both, and a heading both sides wrote is not doubled.
const unionSegments = (mine: readonly string[], theirs: readonly string[]): string[] => {
  const union: string[] = [];
  let mineLine = 0;
  for (const hunk of diffLines(mine, theirs).hunks) {
    union.push(
      ...mine.slice(mineLine, hunk.baseEnd),
      ...theirs.slice(hunk.sideStart, hunk.sideEnd),
    );
    mineLine = hunk.baseEnd;
  }
  union.push(...mine.slice(mineLine));
  return union;
};

interface RegionLines {
  readonly conflicted: boolean;
  readonly lines: readonly string[];
}

// both sides changed the region: the same change is no overlap, anything else is resolved by policy
const bothChanged = (
  mine: readonly string[],
  theirs: readonly string[],
  overlap: Diff3Overlap,
): RegionLines => {
  if (segmentsEqual(mine, theirs)) {
    return { conflicted: false, lines: mine };
  }
  return { conflicted: true, lines: overlap === "union" ? unionSegments(mine, theirs) : mine };
};

export const diff3 = (
  base: string,
  mine: string,
  theirs: string,
  { overlap = "mine" }: Diff3Options = {},
): Diff3Result => {
  if (mine === theirs) {
    return { conflicted: false, merged: mine };
  }
  const baseLines = splitLinesLf(base);
  const mineLines = splitLinesLf(mine);
  const theirsLines = splitLinesLf(theirs);

  const mineCursor: SideCursor = {
    hunks: diffLines(baseLines, mineLines).hunks,
    index: 0,
    sideLine: 0,
  };
  const theirsCursor: SideCursor = {
    hunks: diffLines(baseLines, theirsLines).hunks,
    index: 0,
    sideLine: 0,
  };

  const merged: string[] = [];
  let conflicted = false;
  let baseLine = 0;

  for (;;) {
    const mineNext = mineCursor.hunks[mineCursor.index];
    const theirsNext = theirsCursor.hunks[theirsCursor.index];
    if (mineNext === undefined && theirsNext === undefined) {
      merged.push(...baseLines.slice(baseLine));
      break;
    }
    const regionStart = Math.min(
      mineNext?.baseStart ?? Number.POSITIVE_INFINITY,
      theirsNext?.baseStart ?? Number.POSITIVE_INFINITY,
    );

    merged.push(...baseLines.slice(baseLine, regionStart));
    mineCursor.sideLine += regionStart - baseLine;
    theirsCursor.sideLine += regionStart - baseLine;
    baseLine = regionStart;

    let regionEnd = regionStart;
    const inRegion: RegionHunks = { mine: [], theirs: [] };
    let progressed = true;
    while (progressed) {
      progressed = false;
      const sides: { cursor: SideCursor; bucket: DiffHunk[] }[] = [
        { bucket: inRegion.mine, cursor: mineCursor },
        { bucket: inRegion.theirs, cursor: theirsCursor },
      ];
      for (const { cursor, bucket } of sides) {
        for (;;) {
          const hunk = cursor.hunks[cursor.index];
          if (hunk === undefined || hunk.baseStart > regionEnd) {
            break;
          }
          bucket.push(hunk);
          cursor.index += 1;
          regionEnd = Math.max(regionEnd, hunk.baseEnd);
          progressed = true;
        }
      }
    }

    const takeSegment = (cursor: SideCursor, hunks: DiffHunk[], lines: readonly string[]) => {
      let delta = 0;
      for (const hunk of hunks) {
        delta += hunk.sideEnd - hunk.sideStart - (hunk.baseEnd - hunk.baseStart);
      }
      const start = cursor.sideLine;
      const end = start + (regionEnd - regionStart) + delta;
      cursor.sideLine = end;
      return lines.slice(start, end);
    };
    const mineSegment = takeSegment(mineCursor, inRegion.mine, mineLines);
    const theirsSegment = takeSegment(theirsCursor, inRegion.theirs, theirsLines);

    if (inRegion.mine.length > 0 && inRegion.theirs.length > 0) {
      const region = bothChanged(mineSegment, theirsSegment, overlap);
      conflicted ||= region.conflicted;
      merged.push(...region.lines);
    } else if (inRegion.mine.length > 0) {
      merged.push(...mineSegment);
    } else {
      merged.push(...theirsSegment);
    }
    baseLine = regionEnd;
  }

  return { conflicted, merged: merged.join("\n") };
};
