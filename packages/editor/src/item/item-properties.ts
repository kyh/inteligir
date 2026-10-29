// An item's own properties as the panel's rows: the fields the library holds in place of a
// frontmatter, read off the session's status and written as the field patches it sends at once,
// each over the value the item holds. A value the panel cannot edit (an object, a list that is not
// all words) is drawn as it is and never written.

import type { PropertyValue } from "@repo/notes/library/library-item";
import type { ParsedProperties, TypedProperty } from "@repo/notes/markdown/frontmatter";
import { z } from "zod";

import type { PropertyEdit, PropertySource } from "@repo/editor/properties/property-source";

import type { FieldOp, ItemSession, ItemSessionStatus } from "./item-session";

// the frontmatter reader's own spelling of a date, so a property reads as a date wherever it is
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

const words = z.array(z.string());

const rowOf = (key: string, value: PropertyValue): TypedProperty => {
  const listed = words.safeParse(value);
  if (listed.success) {
    return { key, type: "tags", value: listed.data };
  }
  const checked = z.boolean().safeParse(value);
  if (checked.success) {
    return { key, type: "checkbox", value: checked.data };
  }
  const counted = z.number().safeParse(value);
  if (counted.success) {
    return { key, type: "number", value: counted.data };
  }
  const written = z.string().safeParse(value);
  if (written.success) {
    return DATE_RE.test(written.data)
      ? { key, type: "date", value: written.data }
      : { key, type: "text", value: written.data };
  }
  return { key, rawYaml: JSON.stringify(value), type: "unsupported" };
};

// the value a row writes; null for one the panel does not edit
const valueOf = (prop: TypedProperty): PropertyValue | null =>
  prop.type === "unsupported" ? null : prop.value;

const rowsOf = (status: ItemSessionStatus): ParsedProperties =>
  status.kind === "open"
    ? {
        kind: "valid",
        properties: Object.entries(status.fields.properties).flatMap(([key, value]) =>
          value === undefined ? [] : [rowOf(key, value)],
        ),
      }
    : { kind: "none" };

// the patch an edit makes over the properties the item holds now; none for one that no longer
// applies, or a row the panel does not edit
const patchOf = (
  properties: Readonly<Record<string, PropertyValue | undefined>>,
  edit: PropertyEdit,
): FieldOp | null => {
  const key = edit.kind === "remove" ? edit.key : edit.prop.key;
  const base = Object.hasOwn(properties, key) ? properties[key] : undefined;
  if (edit.kind === "remove") {
    return base === undefined ? null : { base, key, op: "property" };
  }
  const value = valueOf(edit.prop);
  if (value === null || (edit.kind === "add") !== (base === undefined)) {
    return null;
  }
  return base === undefined ? { key, op: "property", value } : { base, key, op: "property", value };
};

export const itemProperties = (session: ItemSession): PropertySource<ItemSessionStatus> => ({
  commit: (edit) => {
    const status = session.status();
    const op = status.kind === "open" ? patchOf(status.fields.properties, edit) : null;
    if (op !== null) {
      void session.patch([op]);
    }
  },
  read: rowsOf,
  snapshot: session.status,
  subscribe: session.subscribe,
});
