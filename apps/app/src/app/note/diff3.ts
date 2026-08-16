// Line-based three-way merge for the open note: base = the last content this
// client saved, mine = the live buffer, theirs = what arrived on disk. A
// region changed on one side takes that side; a region both sides changed
// identically merges silently; a genuine overlap keeps MINE (the buffer is
// the user's work) and reports the conflict so the caller can surface it.
// Line diffs come from a Myers O(ND) walk with prefix/suffix trimming;
// unstable regions not separated by at least one stable line are grouped, as
// classic diff3 does — interleaving adjacent edits would be ambiguous.

/** A maximal run of base lines one side rewrote: base[baseStart, baseEnd)
 *  became side[sideStart, sideEnd). Zero-width base spans are insertions. */
interface DiffHunk {
  baseStart: number;
  baseEnd: number;
  sideStart: number;
  sideEnd: number;
}

/** `splitLines(text).join("\n") === text` — the trailing "" segment of a
 *  newline-terminated text is what preserves the final newline. */
function splitLines(text: string): string[] {
  return text.split("\n");
}

/** Aligned index pairs of matching lines, via the Myers frontier trace. */
function backtrackMatches(
  trace: readonly (readonly number[])[],
  foundD: number,
  offset: number,
  n: number,
  m: number,
): Array<[number, number]> {
  const matches: Array<[number, number]> = [];
  let x = n;
  let y = m;
  for (let d = foundD; d > 0; d -= 1) {
    const frontier = trace[d];
    if (frontier === undefined) {
      throw new Error("diff trace is missing a round");
    }
    const k = x - y;
    const takeDown =
      k === -d || (k !== d && (frontier[offset + k - 1] ?? 0) < (frontier[offset + k + 1] ?? 0));
    const previousK = takeDown ? k + 1 : k - 1;
    const previousX = frontier[offset + previousK] ?? 0;
    const previousY = previousX - previousK;
    // The edit step lands here; the diagonal run back to (x, y) is matches.
    const stepX = takeDown ? previousX : previousX + 1;
    const stepY = takeDown ? previousY + 1 : previousY;
    while (x > stepX && y > stepY) {
      x -= 1;
      y -= 1;
      matches.push([x, y]);
    }
    x = previousX;
    y = previousY;
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    matches.push([x, y]);
  }
  matches.reverse();
  return matches;
}

/** Myers greedy diff over line arrays, returning the changed hunks in order.
 *  Consecutive hunks are always separated by at least one matching line. */
function diffLines(base: readonly string[], side: readonly string[]): DiffHunk[] {
  let prefix = 0;
  const maxPrefix = Math.min(base.length, side.length);
  while (prefix < maxPrefix && base[prefix] === side[prefix]) {
    prefix += 1;
  }
  let baseEnd = base.length;
  let sideEnd = side.length;
  while (baseEnd > prefix && sideEnd > prefix && base[baseEnd - 1] === side[sideEnd - 1]) {
    baseEnd -= 1;
    sideEnd -= 1;
  }
  const a = base.slice(prefix, baseEnd);
  const b = side.slice(prefix, sideEnd);
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) {
    return [];
  }
  if (n === 0 || m === 0) {
    return [{ baseStart: prefix, baseEnd: prefix + n, sideStart: prefix, sideEnd: prefix + m }];
  }

  const max = n + m;
  const offset = max;
  const frontier: number[] = Array.from({ length: 2 * max + 1 }, () => 0);
  const trace: number[][] = [];
  let foundD = -1;
  outer: for (let d = 0; d <= max; d += 1) {
    trace.push([...frontier]);
    for (let k = -d; k <= d; k += 2) {
      const takeDown =
        k === -d || (k !== d && (frontier[offset + k - 1] ?? 0) < (frontier[offset + k + 1] ?? 0));
      let x = takeDown ? (frontier[offset + k + 1] ?? 0) : (frontier[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      frontier[offset + k] = x;
      if (x >= n && y >= m) {
        foundD = d;
        break outer;
      }
    }
  }
  if (foundD < 0) {
    throw new Error("diff walk did not terminate");
  }

  const matches = backtrackMatches(trace, foundD, offset, n, m);

  const hunks: DiffHunk[] = [];
  let lastA = 0;
  let lastB = 0;
  const pushGap = (nextA: number, nextB: number): void => {
    if (nextA > lastA || nextB > lastB) {
      hunks.push({
        baseStart: prefix + lastA,
        baseEnd: prefix + nextA,
        sideStart: prefix + lastB,
        sideEnd: prefix + nextB,
      });
    }
  };
  for (const [matchA, matchB] of matches) {
    pushGap(matchA, matchB);
    lastA = matchA + 1;
    lastB = matchB + 1;
  }
  pushGap(n, m);
  return hunks;
}

export interface Diff3Result {
  merged: string;
  /** True when at least one region was changed differently on both sides;
   *  those regions carry MINE in `merged`. */
  conflicted: boolean;
}

interface SideCursor {
  hunks: DiffHunk[];
  index: number;
  /** Side line index aligned with the base walk position. */
  sideLine: number;
}

export function diff3(base: string, mine: string, theirs: string): Diff3Result {
  if (mine === theirs) {
    return { merged: mine, conflicted: false };
  }
  const baseLines = splitLines(base);
  const mineLines = splitLines(mine);
  const theirsLines = splitLines(theirs);

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

    // Stable run: both sides agree with base, cursors advance in lockstep.
    merged.push(...baseLines.slice(baseLine, regionStart));
    mineCursor.sideLine += regionStart - baseLine;
    theirsCursor.sideLine += regionStart - baseLine;
    baseLine = regionStart;

    // Group every hunk not separated from the region by a stable line.
    let regionEnd = regionStart;
    const inRegion: { mine: DiffHunk[]; theirs: DiffHunk[] } = { mine: [], theirs: [] };
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
      if (mineSegment.join("\n") === theirsSegment.join("\n")) {
        merged.push(...mineSegment);
      } else {
        conflicted = true;
        merged.push(...mineSegment);
      }
    } else if (inRegion.mine.length > 0) {
      merged.push(...mineSegment);
    } else {
      merged.push(...theirsSegment);
    }
    baseLine = regionEnd;
  }

  return { merged: merged.join("\n"), conflicted };
}
