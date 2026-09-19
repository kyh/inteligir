// consecutive hunks are always separated by at least one matching line.
export interface DiffHunk {
  baseStart: number;
  baseEnd: number;
  sideStart: number;
  sideEnd: number;
}

// lf alone, not source-lines' eol-aware `splitLines`: the merge joins segments back into the
// file's bytes, so a `\r` must stay inside a line's content rather than become a terminator.
export const splitLinesLf = (text: string): string[] => text.split("\n");

const backtrackMatches = (
  trace: readonly (readonly number[])[],
  foundD: number,
  offset: number,
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
      k === -d || (k !== d && (frontier[offset + k - 1] ?? 0) < (frontier[offset + k + 1] ?? 0));
    const previousK = takeDown ? k + 1 : k - 1;
    const previousX = frontier[offset + previousK] ?? 0;
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

interface ForwardWalk {
  foundD: number;
  offset: number;
  trace: number[][];
}

const forwardWalk = (a: readonly string[], b: readonly string[]): ForwardWalk => {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  const frontier: number[] = Array.from({ length: 2 * max + 1 }, () => 0);
  const trace: number[][] = [];
  for (let d = 0; d <= max; d += 1) {
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
        return { foundD: d, offset, trace };
      }
    }
  }
  throw new Error("diff walk did not terminate");
};

export const diffLines = (base: readonly string[], side: readonly string[]): DiffHunk[] => {
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
    return [{ baseEnd: prefix + n, baseStart: prefix, sideEnd: prefix + m, sideStart: prefix }];
  }

  const { foundD, offset, trace } = forwardWalk(a, b);
  const matches = backtrackMatches(trace, foundD, offset, n, m);

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
  return hunks;
};
