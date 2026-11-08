// A value SQLite binds or hands back, and a row of them, as every host's driver is held to them at
// its boundary; `./library-sql`'s `SqlValue` and `SqlRow` are their types.

import { z } from "zod";

export const sqlValueSchema = z.union([z.string(), z.number(), z.null()]);
export const sqlRowSchema = z.record(z.string(), sqlValueSchema);

// a TEXT column holding JSON, read as a schema's input: `jsonTextSchema.pipe(schema)`
export const jsonTextSchema = z.string().transform((text, context) => {
  try {
    return z.json().parse(JSON.parse(text));
  } catch {
    context.addIssue({ code: "custom", message: "is not JSON" });
    return z.NEVER;
  }
});
