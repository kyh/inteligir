// a genuine overlap keeps mine (the buffer is the user's work) and reports the conflict.
// unstable regions not separated by a stable line are grouped, as classic diff3 does.

import { diffLines, splitLinesLf, type DiffHunk } from "./line-diff";

export interface Diff3Result {
  merged: string;
  conflicted: boolean;
}

interface SideCursor {
  hunks: DiffHunk[];
  index: number;
  sideLine: number;
}

interface RegionHunks {
  mine: DiffHunk[];
  theirs: DiffHunk[];
}

// element-wise, never joined strings: segmentation participates in equality.
function segmentsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function diff3(base: string, mine: string, theirs: string): Diff3Result {
  if (mine === theirs) {
    return { merged: mine, conflicted: false };
  }
  const baseLines = splitLinesLf(base);
  const mineLines = splitLinesLf(mine);
  const theirsLines = splitLinesLf(theirs);

  const mineCursor: SideCursor = { hunks: diffLines(baseLines, mineLines), index: 0, sideLine: 0 };
  const theirsCursor: SideCursor = {
    hunks: diffLines(baseLines, theirsLines),
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
      const sides: Array<{ cursor: SideCursor; bucket: DiffHunk[] }> = [
        { cursor: mineCursor, bucket: inRegion.mine },
        { cursor: theirsCursor, bucket: inRegion.theirs },
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
      if (!segmentsEqual(mineSegment, theirsSegment)) {
        conflicted = true;
      }
      merged.push(...mineSegment);
    } else if (inRegion.mine.length > 0) {
      merged.push(...mineSegment);
    } else {
      merged.push(...theirsSegment);
    }
    baseLine = regionEnd;
  }

  return { merged: merged.join("\n"), conflicted };
}
