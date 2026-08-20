// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { z } from "zod";
import { jsonObjectSchema, type JsonObject } from "../vocabulary/json-value.js";

export type StringRecord = JsonObject;

/** The value at `key` when the wire sent an object there, else null. */
export function getRecordProperty(value: StringRecord, key: string): StringRecord | null {
  const next = jsonObjectSchema.safeParse(value[key]);
  return next.success ? next.data : null;
}

/** The value at `key` when the wire sent text there, else undefined. */
export function getStringProperty(value: StringRecord, key: string): string | undefined {
  const next = z.string().safeParse(value[key]);
  return next.success ? next.data : undefined;
}
