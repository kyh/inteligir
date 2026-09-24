// consecutive hunks are always separated by at least one matching line.
export interface DiffHunk {
  baseStart: number;
  baseEnd: number;
  sideStart: number;
  sideEnd: number;
}

// `overBudget`: the edit distance passed the budget, so one hunk spans everything between the
// shared prefix and suffix. Still a true diff, only not a minimal one: a three-way merge reads it
// as one changed region, and a concurrent edit inside it is an overlap.
export type LineDiff =
  | { readonly kind: "minimal"; readonly hunks: readonly DiffHunk[] }
  | { readonly kind: "overBudget"; readonly hunks: readonly [DiffHunk] };

export interface DiffLinesOptions {
  readonly maxEditDistance?: number;
}

// the trace keeps every round's live diagonals, so memory is quadratic in the edit distance:
// about four million entries here, where two notes this far apart read as a rewrite anyway.
const DEFAULT_MAX_EDIT_DISTANCE = 2000;

// lf alone, not source-lines' eol-aware `splitLines`: the merge joins segments back into the
// file's bytes, so a `\r` must stay inside a line's content rather than become a terminator.
export const splitLinesLf = (text: string): string[] => text.split("\n");

// round d's snapshot holds diagonals -d..d, so diagonal k sits at `k + d`.
const backtrackMatches = (
  trace: readonly (readonly number[])[],
  foundD: number,
  n: number,
  m: number,
): [number, number][] => {
  const matches: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = foundD; d > 0; d -= 1) {
    const frontier = trace[d];
    if (frontier === undefined) {
      throw new Error("diff trace is missing a round");
    }
    const k = x - y;
    const takeDown =
      k === -d || (k !== d && (frontier[k - 1 + d] ?? 0) < (frontier[k + 1 + d] ?? 0));
    const previousK = takeDown ? k + 1 : k - 1;
    const previousX = frontier[previousK + d] ?? 0;
    const previousY = previousX - previousK;
    // the edit step lands here; the diagonal run back to (x, y) is matches.
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
};

type ForwardWalk = { kind: "found"; foundD: number; trace: number[][] } | { kind: "overBudget" };

const forwardWalk = (
  a: readonly string[],
  b: readonly string[],
  maxEditDistance: number,
): ForwardWalk => {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxEditDistance);
  const offset = max;
  const frontier: number[] = Array.from({ length: 2 * max + 1 }, () => 0);
  const trace: number[][] = [];
  for (let d = 0; d <= max; d += 1) {
    trace.push(frontier.slice(offset - d, offset + d + 1));
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
        return { foundD: d, kind: "found", trace };
      }
    }
  }
  return { kind: "overBudget" };
};

export const diffLines = (
  base: readonly string[],
  side: readonly string[],
  { maxEditDistance = DEFAULT_MAX_EDIT_DISTANCE }: DiffLinesOptions = {},
): LineDiff => {
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
    return { hunks: [], kind: "minimal" };
  }
  const whole: DiffHunk = { baseEnd, baseStart: prefix, sideEnd, sideStart: prefix };
  if (n === 0 || m === 0) {
    return { hunks: [whole], kind: "minimal" };
  }

  const walk = forwardWalk(a, b, maxEditDistance);
  if (walk.kind === "overBudget") {
    return { hunks: [whole], kind: "overBudget" };
  }
  const matches = backtrackMatches(walk.trace, walk.foundD, n, m);

  const hunks: DiffHunk[] = [];
  let lastA = 0;
  let lastB = 0;
  const pushGap = (nextA: number, nextB: number): void => {
    if (nextA > lastA || nextB > lastB) {
      hunks.push({
        baseEnd: prefix + nextA,
        baseStart: prefix + lastA,
        sideEnd: prefix + nextB,
        sideStart: prefix + lastB,
      });
    }
  };
  for (const [matchA, matchB] of matches) {
    pushGap(matchA, matchB);
    lastA = matchA + 1;
    lastB = matchB + 1;
  }
  pushGap(n, m);
  return { hunks, kind: "minimal" };
};
