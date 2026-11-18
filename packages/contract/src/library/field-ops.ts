import { z } from "zod";

import { sameJson } from "./canonical-json";
import type { JsonValue } from "./canonical-json";
import { propertyKeySchema } from "./library-item";
import type { LibraryItemFields } from "./library-item";

const listKey = (op: "aliases" | "tags") => (entry: string) =>
  op === "tags" ? entry.toLowerCase() : entry;

export const mergeListField = (
  op: "aliases" | "tags",
  current: readonly string[],
  base: readonly string[],
  value: readonly string[],
) => {
  const keyOf = listKey(op);
  const kept = new Map(value.map((entry) => [keyOf(entry), entry]));
  const had = new Set(base.map(keyOf));
  const removed = new Set([...had].filter((key) => !kept.has(key)));
  const written = new Set(value);
  const respelled = new Set(base.flatMap((entry) => (written.has(entry) ? [] : [keyOf(entry)])));

  const spelled = (entry: string) => {
    const key = keyOf(entry);

    return respelled.has(key) ? (kept.get(key) ?? entry) : entry;
  };

  const merged = [
    ...new Set(current.flatMap((entry) => (removed.has(keyOf(entry)) ? [] : [spelled(entry)]))),
  ];

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

export const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

export const sameOptionalJson = (a: JsonValue | undefined, b: JsonValue | undefined) =>
  a === undefined || b === undefined ? a === b : sameJson(a, b);

export const propertyOpSchema = z.strictObject({
  base: z.json().optional(),
  key: propertyKeySchema,
  op: z.literal("property"),
  value: z.json().optional(),
});

export type PropertyOp = z.infer<typeof propertyOpSchema>;

export type OpVerdict = "apply" | "satisfied" | "conflict";

export const propertyAt = (fields: LibraryItemFields, key: string) =>
  Object.hasOwn(fields.properties, key) ? fields.properties[key] : undefined;

export const propertyVerdict = (fields: LibraryItemFields, op: PropertyOp) => {
  const current = propertyAt(fields, op.key);

  if (sameOptionalJson(current, op.base)) {
    return "apply" as const;
  }

  return (sameOptionalJson(current, op.value) ? "satisfied" : "conflict") satisfies OpVerdict;
};

export const landPropertyOp = (fields: LibraryItemFields, op: PropertyOp) =>
  ({
    ...fields,
    properties:
      op.value === undefined
        ? Object.fromEntries(Object.entries(fields.properties).filter(([name]) => name !== op.key))
        : { ...fields.properties, [op.key]: op.value },
  }) satisfies LibraryItemFields;

type GuardedOutcome =
  | { readonly kind: "applied"; readonly fields: LibraryItemFields; readonly changed: boolean }
  | { readonly kind: "conflict" };

export const applyGuarded = <Op>(
  fields: LibraryItemFields,
  ops: readonly Op[],
  verdictOf: (fields: LibraryItemFields, op: Op) => OpVerdict,
  land: (fields: LibraryItemFields, op: Op) => LibraryItemFields,
) => {
  let next = fields;
  let changed = false;

  for (const op of ops) {
    const verdict = verdictOf(next, op);

    if (verdict === "conflict") {
      return { kind: "conflict" } satisfies GuardedOutcome;
    }

    if (verdict === "apply") {
      next = land(next, op);
      changed = true;
    }
  }

  return { changed, fields: next, kind: "applied" } satisfies GuardedOutcome;
};

export const applyPropertyOps = (fields: LibraryItemFields, ops: readonly PropertyOp[]) =>
  applyGuarded(fields, ops, propertyVerdict, landPropertyOp);
