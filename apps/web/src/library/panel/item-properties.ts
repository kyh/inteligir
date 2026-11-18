import type { PropertyOp } from "@repo/contract/library/field-ops";
import type { LibraryItemFields, PropertyValue } from "@repo/contract/library/library-item";
import { z } from "zod";

export type Properties = LibraryItemFields["properties"];

export type TypedProperty =
  | { key: string; type: "text"; value: string }
  | { key: string; type: "number"; value: number }
  | { key: string; type: "checkbox"; value: boolean }
  | { key: string; type: "date"; value: string }
  | { key: string; type: "tags"; value: string[] }
  | { key: string; type: "unsupported"; raw: string };

const calendarDate = z.iso.date();

const rowOf = (key: string, value: PropertyValue) => {
  const checkbox = z.boolean().safeParse(value);

  if (checkbox.success) {
    return { key, type: "checkbox", value: checkbox.data } satisfies TypedProperty;
  }

  const number = z.number().safeParse(value);

  if (number.success) {
    return { key, type: "number", value: number.data } satisfies TypedProperty;
  }

  const text = z.string().safeParse(value);

  if (text.success) {
    return (
      calendarDate.safeParse(text.data).success
        ? { key, type: "date", value: text.data }
        : { key, type: "text", value: text.data }
    ) satisfies TypedProperty;
  }

  const tags = z.array(z.string()).safeParse(value);

  if (tags.success) {
    return { key, type: "tags", value: tags.data } satisfies TypedProperty;
  }

  return { key, raw: JSON.stringify(value), type: "unsupported" } satisfies TypedProperty;
};

export const rowsOf = (properties: Properties) =>
  Object.entries(properties).map(([key, value]) => rowOf(key, value));

export const propertyOp = (properties: Properties, key: string, value?: PropertyValue) => {
  const op: PropertyOp = { key, op: "property" };

  if (Object.hasOwn(properties, key)) {
    op.base = properties[key];
  }

  if (value !== undefined) {
    op.value = value;
  }

  return op;
};

const ITEM_NAMES = new Set(["title", "tags", "folder", "pinned"]);

export const nameRefusal = (properties: Properties, name: string) =>
  Object.hasOwn(properties, name) || ITEM_NAMES.has(name.toLowerCase())
    ? "This item already has one by that name."
    : null;
