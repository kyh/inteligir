// Two versions of one saved link settle on one text, whichever device asks: when both carry the
// same url key and at least one changed the fill since their base, the fill that wins comes from a
// total order, and the other side's edits since base are carried onto it (§11). reconcile-file
// asks it before its line merge, and the editor's merges ask mergeItemTexts, so the sync, the
// phone's queue and an open item's save all land the same bytes.

import { diff3 } from "../text/diff3";
import type { Diff3Result } from "../text/diff3";

export interface ItemTexts {
  // null: no common version
  readonly base: string | null;
  readonly mine: string;
  readonly theirs: string;
}

// the one text both versions of one saved link settle on; null where neither side changed the
// fill against the other, and the caller's own rules (diff3) apply
// PIVOT-STUB(M): answers null until the fill-aware verdict lands (§11.2, §11.3)
export const urlItemVerdict = (_texts: ItemTexts): string | null => null;

// the editor's text merge: the verdict where it applies, else diff3
export const mergeItemTexts = (base: string, mine: string, theirs: string): Diff3Result => {
  const settled = urlItemVerdict({ base, mine, theirs });
  return settled === null ? diff3(base, mine, theirs) : { conflicted: false, merged: settled };
};
