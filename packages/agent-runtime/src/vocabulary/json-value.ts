// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { z } from "zod";

export type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

/** A decoded JSON object: the keys are whatever the wire sent, and each value
 *  is still JSON — a schema for the specific message is what gives one a
 *  domain type. */
export type JsonObject = { [key: string]: JsonValue | undefined };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.number(),
    z.string(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);
