import { sameJson } from "@repo/contract/library/canonical-json";
import {
  applyGuarded,
  landPropertyOp,
  mergeListField,
  propertyAt,
  propertyOpSchema,
  propertyVerdict,
  sameList,
  sameOptionalJson,
} from "@repo/contract/library/field-ops";
import type { OpVerdict } from "@repo/contract/library/field-ops";
import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { z } from "zod";

type ScalarField = Exclude<keyof LibraryItemFields, "aliases" | "properties" | "tags">;

const isScalarField = (field: keyof LibraryItemFields): field is ScalarField =>
  field !== "aliases" && field !== "properties" && field !== "tags";

export const SCALAR_FIELDS = libraryItemFieldsSchema.keyof().options.filter(isScalarField);

const FIELDS = libraryItemFieldsSchema.shape;

const setOf = <F extends ScalarField>(field: F) =>
  z.strictObject({
    base: FIELDS[field],
    field: z.literal(field),
    op: z.literal("set"),
    value: FIELDS[field],
  });

const setOpSchema = z.discriminatedUnion("field", [
  setOf("author"),
  setOf("coverSha"),
  setOf("deletedAt"),
  setOf("description"),
  setOf("parentId"),
  setOf("kind"),
  setOf("lang"),
  setOf("originalName"),
  setOf("originalSha"),
  setOf("pinnedAt"),
  setOf("published"),
  setOf("reading"),
  setOf("savedAt"),
  setOf("site"),
  setOf("title"),
  setOf("url"),
]);

const tagsOpSchema = z.strictObject({
  base: FIELDS.tags,
  op: z.literal("tags"),
  value: FIELDS.tags,
});

const aliasesOpSchema = z.strictObject({
  base: FIELDS.aliases,
  op: z.literal("aliases"),
  value: FIELDS.aliases,
});

export const inverseOpSchema = z.discriminatedUnion("op", [
  setOpSchema,
  tagsOpSchema,
  aliasesOpSchema,
  propertyOpSchema,
]);

export type InverseOp = z.infer<typeof inverseOpSchema>;

type SetOp<F extends ScalarField> = {
  [P in F]: { base: LibraryItemFields[P]; field: P; op: "set"; value: LibraryItemFields[P] };
}[F];

const setOp: <F extends ScalarField>(
  field: F,
  from: LibraryItemFields,
  to: LibraryItemFields,
) => SetOp<F> = <F extends ScalarField>(field: F, from: LibraryItemFields, to: LibraryItemFields) =>
  ({ base: from[field], field, op: "set", value: to[field] }) satisfies SetOp<F>;

const verdictOf = (fields: LibraryItemFields, op: InverseOp) => {
  switch (op.op) {
    case "set": {
      const current = fields[op.field];

      if (sameJson(current, op.base)) {
        return "apply" as const;
      }

      return (sameJson(current, op.value) ? "satisfied" : "conflict") satisfies OpVerdict;
    }

    case "tags":
    case "aliases": {
      const current = fields[op.op];

      return (
        sameList(mergeListField(op.op, current, op.base, op.value), current) ? "satisfied" : "apply"
      ) satisfies OpVerdict;
    }

    case "property": {
      return propertyVerdict(fields, op);
    }

    default: {
      throw new Error(`unexpected ${String(op satisfies never)}`);
    }
  }
};

const withField = <F extends ScalarField>(
  fields: LibraryItemFields,
  field: F,
  value: LibraryItemFields[F],
) => ({ ...fields, [field]: value }) satisfies LibraryItemFields;

const landOp = (fields: LibraryItemFields, op: InverseOp) => {
  switch (op.op) {
    case "set": {
      return withField(fields, op.field, op.value);
    }

    case "tags":
    case "aliases": {
      return {
        ...fields,
        [op.op]: mergeListField(op.op, fields[op.op], op.base, op.value),
      } satisfies LibraryItemFields;
    }

    case "property": {
      return landPropertyOp(fields, op);
    }

    default: {
      throw new Error(`unexpected ${String(op satisfies never)}`);
    }
  }
};

export const applyInverse = (fields: LibraryItemFields, ops: readonly InverseOp[]) =>
  applyGuarded(fields, ops, verdictOf, landOp);

const slotOf = (op: InverseOp) => {
  switch (op.op) {
    case "set": {
      return op.field;
    }

    case "property": {
      return `property:${op.key}`;
    }

    case "tags":
    case "aliases": {
      return op.op;
    }

    default: {
      throw new Error(`unexpected ${String(op satisfies never)}`);
    }
  }
};

const opsBetween = (from: LibraryItemFields, to: LibraryItemFields) => {
  const ops: InverseOp[] = [];

  for (const field of SCALAR_FIELDS) {
    if (!sameJson(from[field], to[field])) {
      ops.push(setOp(field, from, to));
    }
  }

  for (const op of ["tags", "aliases"] as const) {
    if (!sameList(from[op], to[op])) {
      ops.push({ base: from[op], op, value: to[op] });
    }
  }

  for (const key of new Set([...Object.keys(from.properties), ...Object.keys(to.properties)])) {
    const [base, value] = [propertyAt(from, key), propertyAt(to, key)];

    if (!sameOptionalJson(base, value)) {
      ops.push({ base, key, op: "property", value });
    }
  }

  return ops;
};

export const composeInverse = (
  inverse: readonly InverseOp[],
  before: LibraryItemFields,
  after: LibraryItemFields,
) => {
  const landed = new Set(opsBetween(before, after).map(slotOf));
  let target = before;

  for (const op of inverse) {
    if (landed.has(slotOf(op)) && verdictOf(target, op) === "apply") {
      target = landOp(target, op);
    }
  }

  return [
    ...inverse.filter((op) => !landed.has(slotOf(op))),
    ...opsBetween(after, target).filter((op) => landed.has(slotOf(op))),
  ] satisfies InverseOp[];
};
