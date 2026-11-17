// An existing item's fields landed inside a write's transaction, by the rules every write meets
// (`./library-landing`), and only when something changed. The library's own verbs compute the
// fields over the item they read in the same transaction and land them: an organize, Deleted and
// back. Only a device's property ops name a base, the value it showed
// (`@repo/contract/library/field-ops`).

import { canonicalJson } from "@repo/contract/library/canonical-json";
import { applyPropertyOps } from "@repo/contract/library/field-ops";
import type { PropertyOp } from "@repo/contract/library/field-ops";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { liveItemRowSchema } from "@repo/contract/library/library-wire";
import { z } from "zod";

import { landItem } from "./library-landing";
import type { LiveItemRow } from "./library-landing";
import { refuse } from "./library-refusal";
import { readItem } from "./library-rows";
import type { StoredItem } from "./library-rows";
import type { WriteScope } from "./library-store";

export interface PropertyWrite {
  readonly itemId: string;
  readonly ops: readonly PropertyOp[];
}

// what a write of one item answers: the item as it landed
export const landedSchema = z.object({ item: liveItemRowSchema });

// the item as it stands, as a write answers it
export const liveRowOf = ({ card, fields, id, seq, updatedAt }: StoredItem): LiveItemRow => ({
  card,
  fields,
  id,
  seq,
  updatedAt,
});

// the item with `fields` in place of its own; fields left as they were land nothing, and answer the
// item as it stands
export const landFields = async (
  scope: WriteScope,
  item: StoredItem,
  fields: LibraryItemFields,
): Promise<LiveItemRow> =>
  canonicalJson(item.fields) === canonicalJson(fields)
    ? liveRowOf(item)
    : await landItem(scope, { before: item, body: null, fields, itemId: item.id });

export const landPropertyOps = async (
  scope: WriteScope,
  input: PropertyWrite,
): Promise<LiveItemRow> => {
  const before = await readItem(scope.tx, scope.accountId, input.itemId);
  if (before === null) {
    return refuse({ kind: "not-found" });
  }
  const outcome = applyPropertyOps(before.fields, input.ops);
  return outcome.kind === "conflict"
    ? refuse({ kind: "conflict" })
    : await landFields(scope, before, outcome.fields);
};
