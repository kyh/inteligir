// Takes one writer's change to a file back while keeping every change made there since: the
// change's own three-way merge run backwards, with the bytes it left as the base, the bytes now
// as mine and the bytes from before it as theirs. A file whose later edits overlap the change is
// kept whole and named, never half taken back. Bytes in, a verdict out: the caller reads the
// three versions and lands the verdict through its own compare-and-swap.

import { diff3 } from "./diff3";

// what the change did to the file: edited it, created it (nothing before) or deleted it
// (nothing after)
export type TurnEdit =
  | { readonly before: string; readonly after: string }
  | { readonly before: null; readonly after: string }
  | { readonly before: string; readonly after: null };

export type RevertInput = TurnEdit & {
  // null: no file at the path now
  readonly current: string | null;
};

export type RevertKeepReason = "edited-since" | "deleted-since" | "recreated-since";

// `expected` is the bytes the verdict was computed from, which the caller's compare-and-swap
// must still find at the path
export type RevertVerdict =
  | { readonly kind: "unchanged" }
  | { readonly kind: "write"; readonly expected: string; readonly content: string }
  | { readonly kind: "remove"; readonly expected: string }
  | { readonly kind: "recreate"; readonly content: string }
  | { readonly kind: "keep"; readonly reason: RevertKeepReason };

// null when neither side holds a file: the change named a path that was never text to revert
export const turnEditOf = (before: string | null, after: string | null): TurnEdit | null => {
  if (before !== null && after !== null) {
    return { after, before };
  }
  if (before !== null) {
    return { after: null, before };
  }
  if (after !== null) {
    return { after, before: null };
  }
  return null;
};

const UNCHANGED: RevertVerdict = { kind: "unchanged" };

const keep = (reason: RevertKeepReason): RevertVerdict => ({ kind: "keep", reason });

export const revertEdit = (input: RevertInput): RevertVerdict => {
  const { before, after, current } = input;
  if (current === before) {
    return UNCHANGED;
  }
  if (before === null) {
    return current === after ? { expected: after, kind: "remove" } : keep("edited-since");
  }
  if (after === null) {
    return current === null ? { content: before, kind: "recreate" } : keep("recreated-since");
  }
  if (current === null) {
    return keep("deleted-since");
  }
  const { conflicted, merged } = diff3(after, current, before);
  if (conflicted) {
    return keep("edited-since");
  }
  return merged === current ? UNCHANGED : { content: merged, expected: current, kind: "write" };
};
