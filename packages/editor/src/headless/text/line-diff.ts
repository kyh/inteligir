import { diffArrays } from "diff";

// consecutive hunks are always separated by at least one matching line.
export interface DiffHunk {
  baseStart: number;
  baseEnd: number;
  sideStart: number;
  sideEnd: number;
}

// `overBudget`: the edit distance passed the budget, so one hunk spans everything between the
// shared prefix and suffix. Still a true diff, only not a minimal one.
export type LineDiff =
  | { readonly kind: "minimal"; readonly hunks: readonly DiffHunk[] }
  | { readonly kind: "overBudget"; readonly hunks: readonly [DiffHunk] };

export interface DiffLinesOptions {
  readonly maxEditDistance?: number;
}

// jsdiff keeps every live path's changes, so memory grows with the square of the edit distance,
// and two notes this far apart read as a rewrite anyway.
const DEFAULT_MAX_EDIT_DISTANCE = 2000;

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
  const changes = diffArrays(base.slice(prefix, baseEnd), side.slice(prefix, sideEnd), {
    maxEditLength: maxEditDistance,
  });
  if (changes === undefined) {
    return {
      hunks: [{ baseEnd, baseStart: prefix, sideEnd, sideStart: prefix }],
      kind: "overBudget",
    };
  }
  const hunks: DiffHunk[] = [];
  let baseAt = prefix;
  let sideAt = prefix;
  for (const { added, count, removed } of changes) {
    if (added || removed) {
      const last = hunks.at(-1);
      const open =
        last?.baseEnd === baseAt && last.sideEnd === sideAt
          ? last
          : { baseEnd: baseAt, baseStart: baseAt, sideEnd: sideAt, sideStart: sideAt };
      if (open !== last) {
        hunks.push(open);
      }
      baseAt += removed ? count : 0;
      sideAt += added ? count : 0;
      open.baseEnd = baseAt;
      open.sideEnd = sideAt;
    } else {
      baseAt += count;
      sideAt += count;
    }
  }
  return { hunks, kind: "minimal" };
};
