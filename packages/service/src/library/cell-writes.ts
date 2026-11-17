// An existing item's fields landed inside a write's transaction, by the rules every write meets
// (`./cell-landing`), and only when something changed. The cell's own verbs compute the fields over
// the item they read in the same transaction and land them: an organize, Deleted and back, a
// reading. Only a device's property ops name a base, the value it showed
// (`@repo/contract/library/field-ops`). An undo (`./cell-undo`) lands the fields its way back
// leaves, and a purge (`./cell-items`) empties the item.

import { applyPropertyOps } from "@repo/contract/library/field-ops";
import type { PropertyOp } from "@repo/contract/library/field-ops";
import { canonicalJson } from "@repo/contract/library/canonical-json";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { liveItemRowSchema } from "@repo/contract/library/library-wire";
import { z } from "zod";
import { readItem } from "./library-queries";
import type { StoredItem } from "./library-queries";

import { landItem } from "./cell-landing";
import type { ItemScope, LiveItemRow } from "./cell-landing";
import { refuse } from "./cell-refusal";

export interface PropertyWrite {
  readonly itemId: string;
  readonly ops: readonly PropertyOp[];
}

// what a write of one item answers: the item as it landed
export const landedSchema = z.object({ item: liveItemRowSchema });

const rowOf = ({ card, fields, id, seq, updatedAt }: StoredItem): LiveItemRow => ({
  card,
  fields,
  id,
  seq,
  updatedAt,
});

// the item's row as it stands, for a save of an address the item holds
export const liveRowOf = (scope: ItemScope, itemId: string): LiveItemRow => {
  const item = readItem(scope.db, itemId);
  return item === null ? refuse({ kind: "not-found" }) : rowOf(item);
};

// the item with `fields` in place of its own; fields left as they were land nothing, and answer the
// item as it stands
export const landFields = (
  scope: ItemScope,
  item: StoredItem,
  fields: LibraryItemFields,
): LiveItemRow =>
  canonicalJson(item.fields) === canonicalJson(fields)
    ? rowOf(item)
    : landItem(scope, { before: item, fields, itemId: item.id, seed: null });

export const landPropertyOps = (scope: ItemScope, input: PropertyWrite): LiveItemRow => {
  const before = readItem(scope.db, input.itemId);
  if (before === null) {
    return refuse({ kind: "not-found" });
  }
  const outcome = applyPropertyOps(before.fields, input.ops);
  return outcome.kind === "conflict"
    ? refuse({ kind: "conflict" })
    : landFields(scope, before, outcome.fields);
};
