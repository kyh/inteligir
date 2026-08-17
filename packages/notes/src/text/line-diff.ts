// Myers O(ND) diff over line arrays — the ONE line-diff in the repo, shared
// by the workspace's diff3 merge and the editor's cursor-preserving external
// replace. Pure and platform-neutral: arrays in, hunks out.

/** A maximal run of base lines one side rewrote: base[baseStart, baseEnd)
 * became side[sideStart, sideEnd). Zero-width base spans are insertions.
 * Consecutive hunks are always separated by at least one matching line. */
export interface DiffHunk {
  baseStart: number;
  baseEnd: number;
  sideStart: number;
  sideEnd: number;
}

/** `splitLines(text).join("\n") === text` — the trailing "" segment of a
 * newline-terminated text is what preserves the final newline. */
export function splitLines(text: string): string[] {
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

/** Myers greedy diff, returning the changed hunks in order. */
export function diffLines(base: readonly string[], side: readonly string[]): DiffHunk[] {
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
