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

export const landedSchema = z.object({ item: liveItemRowSchema });

export const liveRowOf = ({ card, fields, id, seq, updatedAt }: StoredItem) =>
  ({
    card,
    fields,
    id,
    seq,
    updatedAt,
  }) satisfies LiveItemRow;

export const landFields = async (scope: WriteScope, item: StoredItem, fields: LibraryItemFields) =>
  canonicalJson(item.fields) === canonicalJson(fields)
    ? liveRowOf(item)
    : await landItem(scope, { before: item, body: null, fields, itemId: item.id });

export const landPropertyOps = async (scope: WriteScope, input: PropertyWrite) => {
  const before = await readItem(scope.tx, scope.accountId, input.itemId);

  if (before === null) {
    return refuse({ kind: "not-found" });
  }

  const outcome = applyPropertyOps(before.fields, input.ops);

  return outcome.kind === "conflict"
    ? refuse({ kind: "conflict" })
    : await landFields(scope, before, outcome.fields);
};
