// One item's field ops landed inside a write's transaction: guarded field by field
// (`@repo/contract/library/field-ops`), every conflict answered together, and the item laid only when
// something changed. Every write the cell's procedures make of an existing item's fields comes
// through here: a device's own ops, a reading, an organize, Deleted and back. An undo
// (`./cell-undo`) lands the fields it merged, and a purge (`./library-engine`) a tombstone.

import { applyFieldOps } from "@repo/contract/library/field-ops";
import type { FieldConflict, FieldOp } from "@repo/contract/library/field-ops";
import { readLiveItem } from "./library-queries";
import { z } from "zod";

import { landItem } from "./cell-landing";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { refuse } from "./cell-refusal";
import type { ConflictCurrent } from "./cell-refusal";

export interface ItemWrite {
  readonly itemId: string;
  readonly ops: readonly FieldOp[];
}

const conflictCurrentOf = (itemId: string, conflict: FieldConflict): ConflictCurrent => {
  switch (conflict.kind) {
    case "field": {
      return {
        current: z.json().parse(conflict.current),
        field: conflict.field,
        itemId,
        kind: "field",
      };
    }
    case "property": {
      return conflict.current === undefined
        ? { itemId, key: conflict.key, kind: "property" }
        : {
            current: z.json().parse(conflict.current),
            itemId,
            key: conflict.key,
            kind: "property",
          };
    }
    // no default
  }
};

// the item's row as it stands, for a write every op of which was already true, or a save of an
// address the item holds
export const liveRowOf = (scope: LandingScope, itemId: string): LiveItemRow => {
  const item = readLiveItem(scope.storage.db, itemId);
  if (item === null) {
    return refuse({ kind: "not-found" });
  }
  const { card, fields, seq, updatedAt } = item;
  return { card, fields, id: itemId, kind: "live", seq, updatedAt };
};

export const landWrite = (scope: LandingScope, input: ItemWrite): LiveItemRow => {
  const { itemId } = input;
  const before = readLiveItem(scope.storage.db, itemId);
  if (before === null) {
    return refuse({ kind: "not-found" });
  }
  const outcome = applyFieldOps(before.fields, input.ops);
  if (outcome.kind === "conflict") {
    refuse({
      current: outcome.conflicts.map((conflict) => conflictCurrentOf(itemId, conflict)),
      kind: "conflict",
    });
  }
  if (outcome.kind !== "applied") {
    return refuse({ kind: "too-large" });
  }
  return outcome.changed
    ? landItem(scope, { before, fields: outcome.fields, itemId, seed: null })
    : liveRowOf(scope, itemId);
};
