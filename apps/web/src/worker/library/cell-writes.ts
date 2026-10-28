// One item's ops and highlight writes landed inside a write's transaction: the ops guarded block by
// block and field by field (`@repo/notes/library/block-ops`), the highlights by the note text they
// were computed from (`./cell-annotations`), every conflict answered together, and the item laid
// only when something changed. Every write the cell's procedures make of an existing item comes
// through here: a device's own ops, an agent's edit, a fold of a save, an organize.

import type { annotationOpSchema } from "@repo/contract/cloud/library/library-wire";
import { applyOps } from "@repo/notes/library/block-ops";
import type { LibraryOp } from "@repo/notes/library/block-ops";
import { readItem, readItemState } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";
import { z } from "zod";

import { annotationSourceOf } from "./cell-actor";
import type { CellActor } from "./cell-actor";
import { applyAnnotationOps, readAnnotationRow, readAnnotationRows } from "./cell-annotations";
import { landItem } from "./cell-landing";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { refuse } from "./cell-refusal";
import type { ConflictCurrent } from "./cell-refusal";

type AnnotationOp = z.infer<typeof annotationOpSchema>;

export interface ItemWrite {
  readonly itemId: string;
  readonly ops: readonly LibraryOp[];
  readonly annotations?: readonly AnnotationOp[] | undefined;
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

// the item's row as it stands, for a write every op of which was already true
const liveRowOf = (scope: LandingScope, itemId: string): LiveItemRow => {
  const item = runPlan(scope.storage, readItem(itemId));
  if (item?.kind !== "live") {
    return refuse({ kind: "not-found" });
  }
  const { card, fields, seq, updatedAt } = item;
  return { card, fields, id: itemId, kind: "live", seq, updatedAt };
};

export const landWrite = (scope: LandingScope, actor: CellActor, input: ItemWrite): LiveItemRow => {
  const { storage } = scope;
  const { itemId } = input;
  const state = runPlan(storage, readItemState(itemId));
  if (state === null) {
    return refuse({ kind: "not-found" });
  }
  const outcome = applyOps(state, input.ops);
  const rows = readAnnotationRows(storage, itemId);
  const highlights = applyAnnotationOps(rows, input.annotations ?? [], {
    itemId,
    nowSeconds: Math.floor(scope.now / 1000),
    readRow: (id) => readAnnotationRow(storage, id),
    source: annotationSourceOf(actor),
  });
  const conflicts = [
    ...(outcome.kind === "conflict"
      ? outcome.conflicts.map((conflict) => conflictCurrentOf(itemId, conflict))
      : []),
    ...highlights.conflicts,
  ];
  if (conflicts.length > 0) {
    refuse({ current: conflicts, kind: "conflict" });
  }
  if (outcome.kind !== "applied") {
    return refuse({ kind: "too-large" });
  }
  const { touched } = outcome;
  const unchanged =
    touched.blocks.size === 0 &&
    touched.dropped.size === 0 &&
    !touched.fields &&
    highlights.landed.changed.size === 0;
  return unchanged
    ? liveRowOf(scope, itemId)
    : landItem(scope, {
        after: outcome.state,
        annotations: highlights.landed,
        before: { rows, state },
        itemId,
      });
};
