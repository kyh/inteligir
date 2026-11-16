// What a device writes to an item's fields, apart from its body: one property by its key, guarded
// by the value the device showed, since it computed the op away from the cell. A batch lands whole
// or not at all, and an op already true is satisfied. The cell's own verbs compute the fields they
// land where they read them, so they name no base. A list kept as a set merges three ways.

import { z } from "zod";

import { sameJson } from "./canonical-json";
import type { JsonValue } from "./canonical-json";
import { propertyKeySchema } from "./library-item";
import type { LibraryItemFields, PropertyValue } from "./library-item";

const listKey = (op: "aliases" | "tags") => (entry: string) =>
  op === "tags" ? entry.toLowerCase() : entry;

// three-way over a list kept as a set: `current`, less what `base` had and `value` dropped, plus
// what `value` added, in the order it added them. An entry `value` spells anew under a key `base`
// held takes that spelling where it stands; one `value` left as `base` spelled it stays as it is
export const mergeListField = (
  op: "aliases" | "tags",
  current: readonly string[],
  base: readonly string[],
  value: readonly string[],
): string[] => {
  const keyOf = listKey(op);
  const kept = new Map(value.map((entry) => [keyOf(entry), entry]));
  const had = new Set(base.map(keyOf));
  const removed = new Set([...had].filter((key) => !kept.has(key)));
  const written = new Set(value);
  const respelled = new Set(base.filter((entry) => !written.has(entry)).map(keyOf));
  const spelled = (entry: string): string => {
    const key = keyOf(entry);
    return respelled.has(key) ? (kept.get(key) ?? entry) : entry;
  };
  const merged = [...new Set(current.filter((entry) => !removed.has(keyOf(entry))).map(spelled))];
  const present = new Set(merged.map(keyOf));
  for (const entry of value) {
    const key = keyOf(entry);
    if (!had.has(key) && !present.has(key)) {
      merged.push(entry);
      present.add(key);
    }
  }
  return merged;
};

export const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

export const sameOptionalJson = (a: JsonValue | undefined, b: JsonValue | undefined): boolean =>
  a === undefined || b === undefined ? a === b : sameJson(a, b);

// one property by its key; a missing base or value is the property absent. The value's size is
// the item's to hold: the fields are checked whole as they land
export const propertyOpSchema = z.strictObject({
  base: z.json().optional(),
  key: propertyKeySchema,
  op: z.literal("property"),
  value: z.json().optional(),
});
export type PropertyOp = z.infer<typeof propertyOpSchema>;

// `satisfied`: what the op would make is already there (a resend after a lost answer, or two
// writers doing the same thing), so landing it changes nothing. `conflict`: the op met neither its
// base nor its value
export type OpVerdict = "apply" | "satisfied" | "conflict";

export const propertyAt = (fields: LibraryItemFields, key: string): PropertyValue | undefined =>
  Object.hasOwn(fields.properties, key) ? fields.properties[key] : undefined;

export const propertyVerdict = (fields: LibraryItemFields, op: PropertyOp): OpVerdict => {
  const current = propertyAt(fields, op.key);
  if (sameOptionalJson(current, op.base)) {
    return "apply";
  }
  return sameOptionalJson(current, op.value) ? "satisfied" : "conflict";
};

export const landPropertyOp = (fields: LibraryItemFields, op: PropertyOp): LibraryItemFields => {
  const properties = Object.fromEntries(
    Object.entries(fields.properties).filter(([name]) => name !== op.key),
  );
  if (op.value !== undefined) {
    properties[op.key] = op.value;
  }
  return { ...fields, properties };
};

export type GuardedOutcome =
  | { readonly kind: "applied"; readonly fields: LibraryItemFields; readonly changed: boolean }
  | { readonly kind: "conflict" };

// every op in order, each against the fields as the ones before it left them; one conflict lands
// none
export const applyGuarded = <Op>(
  fields: LibraryItemFields,
  ops: readonly Op[],
  verdictOf: (fields: LibraryItemFields, op: Op) => OpVerdict,
  land: (fields: LibraryItemFields, op: Op) => LibraryItemFields,
): GuardedOutcome => {
  let next = fields;
  let changed = false;
  for (const op of ops) {
    const verdict = verdictOf(next, op);
    if (verdict === "conflict") {
      return { kind: "conflict" };
    }
    if (verdict === "apply") {
      next = land(next, op);
      changed = true;
    }
  }
  return { changed, fields: next, kind: "applied" };
};

export const applyPropertyOps = (
  fields: LibraryItemFields,
  ops: readonly PropertyOp[],
): GuardedOutcome => applyGuarded(fields, ops, propertyVerdict, landPropertyOp);
