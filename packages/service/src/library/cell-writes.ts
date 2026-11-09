// One item's ops landed inside a write's transaction: guarded block by block and field by field
// (`@repo/contract/library/block-ops`), every conflict answered together, and the item laid only when
// something changed. Every write the cell's procedures make of an existing item by ops
// comes through here: a device's own ops, an agent's edit, a reading, an organize. An undo
// (`./cell-undo`) lands a state it merged, and a purge (`./library-engine`) a tombstone.

import { applyOps } from "@repo/contract/library/block-ops";
import type { LibraryOp } from "@repo/contract/library/block-ops";
import { readItem, readItemState } from "./library-queries";
import { z } from "zod";

import { landItem } from "./cell-landing";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { refuse } from "./cell-refusal";
import type { ConflictCurrent } from "./cell-refusal";

export interface ItemWrite {
  readonly itemId: string;
  readonly ops: readonly LibraryOp[];
}

type OpConflict = Extract<ReturnType<typeof applyOps>, { kind: "conflict" }>["conflicts"][number];

const conflictCurrentOf = (itemId: string, conflict: OpConflict): ConflictCurrent => {
  switch (conflict.kind) {
    case "block": {
      return { blockId: conflict.blockId, current: conflict.current, itemId, kind: "block" };
    }
    case "order": {
      return { blockId: conflict.blockId, currentOrd: conflict.currentOrd, itemId, kind: "order" };
    }
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
  const item = readItem(scope.storage.db, itemId);
  if (item?.kind !== "live") {
    return refuse({ kind: "not-found" });
  }
  const { card, fields, seq, updatedAt } = item;
  return { card, fields, id: itemId, kind: "live", seq, updatedAt };
};

export const landWrite = (scope: LandingScope, input: ItemWrite): LiveItemRow => {
  const { itemId } = input;
  const state = readItemState(scope.storage, itemId);
  if (state === null) {
    return refuse({ kind: "not-found" });
  }
  const outcome = applyOps(state, input.ops);
  if (outcome.kind === "conflict") {
    refuse({
      current: outcome.conflicts.map((conflict) => conflictCurrentOf(itemId, conflict)),
      kind: "conflict",
    });
  }
  if (outcome.kind !== "applied") {
    return refuse({ kind: "too-large" });
  }
  const { touched } = outcome;
  const unchanged = touched.blocks.size === 0 && touched.dropped.size === 0 && !touched.fields;
  return unchanged
    ? liveRowOf(scope, itemId)
    : landItem(scope, { after: outcome.state, before: state, itemId });
};
