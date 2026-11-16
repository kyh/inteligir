// One item's field ops landed inside a write's transaction: guarded field by field
// (`@repo/contract/library/field-ops`), whole or not at all, and the item laid only when something
// changed. Every write the cell's procedures make of an existing item's fields comes through here:
// a device's own ops, a reading, an organize, Deleted and back. An undo (`./cell-undo`) lands the
// fields it merged, and a purge (`./library-engine`) empties the item.

import { applyFieldOps } from "@repo/contract/library/field-ops";
import type { FieldOp } from "@repo/contract/library/field-ops";
import { readItem } from "./library-queries";

import { landItem } from "./cell-landing";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { refuse } from "./cell-refusal";

export interface ItemWrite {
  readonly itemId: string;
  readonly ops: readonly FieldOp[];
}

// the item's row as it stands, for a write every op of which was already true, or a save of an
// address the item holds
export const liveRowOf = (scope: LandingScope, itemId: string): LiveItemRow => {
  const item = readItem(scope.db, itemId);
  if (item === null) {
    return refuse({ kind: "not-found" });
  }
  const { card, fields, seq, updatedAt } = item;
  return { card, fields, id: itemId, seq, updatedAt };
};

export const landWrite = (scope: LandingScope, input: ItemWrite): LiveItemRow => {
  const { itemId } = input;
  const before = readItem(scope.db, itemId);
  if (before === null) {
    return refuse({ kind: "not-found" });
  }
  const outcome = applyFieldOps(before.fields, input.ops);
  if (outcome.kind !== "applied") {
    return refuse({ kind: outcome.kind === "conflict" ? "conflict" : "too-large" });
  }
  return outcome.changed
    ? landItem(scope, { before, fields: outcome.fields, itemId, seed: null })
    : liveRowOf(scope, itemId);
};
