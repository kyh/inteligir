import { z } from "zod";

// a TEXT column holding JSON, read as a schema's input: `jsonTextSchema.pipe(schema)`
export const jsonTextSchema = z.string().transform((text, context) => {
  try {
    return z.json().parse(JSON.parse(text));
  } catch {
    context.addIssue({ code: "custom", message: "is not JSON" });
    return z.NEVER;
  }
});
