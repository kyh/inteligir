import type { z } from "zod";

// a newer build sharing this data dir can store a shape this build's grammar has never seen, and no
// migration fences it: the row reads as null rather than throwing for every row beside it.
export const readJsonColumn = <T>(text: string, schema: z.ZodType<T>): T | null => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : null;
};
