// An existing item's fields landed inside a write's transaction, by the rules every write meets
// (`./cell-landing`), and only when something changed. The cell's own verbs compute the fields over
// the item they read in the same transaction and land them: an organize, Deleted and back, a
// reading. A device's ops are guarded by the values it showed (`@repo/contract/library/field-ops`).
// An undo (`./cell-undo`) lands the fields its way back leaves, and a purge (`./library-engine`) a
// tombstone.

import { applyFieldOps } from "@repo/contract/library/field-ops";
import type { FieldOp } from "@repo/contract/library/field-ops";
import { canonicalJson } from "@repo/contract/library/canonical-json";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { readLiveItem } from "./library-queries";
import type { LiveStoredItem } from "./library-queries";

import { landItem } from "./cell-landing";
import type { LandingScope, LiveItemRow } from "./cell-landing";
import { refuse } from "./cell-refusal";

export interface ItemWrite {
  readonly itemId: string;
  readonly ops: readonly FieldOp[];
}

const rowOf = ({ card, fields, id, seq, updatedAt }: LiveStoredItem): LiveItemRow => ({
  card,
  fields,
  id,
  seq,
  updatedAt,
});

// the item's row as it stands, for a save of an address the item holds
export const liveRowOf = (scope: LandingScope, itemId: string): LiveItemRow => {
  const item = readLiveItem(scope.db, itemId);
  return item === null ? refuse({ kind: "not-found" }) : rowOf(item);
};

// the item with `fields` in place of its own; fields left as they were land nothing, and answer the
// item as it stands
export const landFields = (
  scope: LandingScope,
  item: LiveStoredItem,
  fields: LibraryItemFields,
): LiveItemRow =>
  canonicalJson(item.fields) === canonicalJson(fields)
    ? rowOf(item)
    : landItem(scope, { before: item, fields, itemId: item.id, seed: null });

export const landWrite = (scope: LandingScope, input: ItemWrite): LiveItemRow => {
  const before = readLiveItem(scope.db, input.itemId);
  if (before === null) {
    return refuse({ kind: "not-found" });
  }
  const outcome = applyFieldOps(before.fields, input.ops);
  if (outcome.kind !== "applied") {
    return refuse({ kind: outcome.kind === "conflict" ? "conflict" : "too-large" });
  }
  return landFields(scope, before, outcome.fields);
};
