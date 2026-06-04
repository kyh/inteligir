import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schemaAuth from "./drizzle-schema-auth";

// Lazy connection — instantiating postgres() at module load makes
// `next build` (which evaluates route handlers to collect page data) fail
// when POSTGRES_URL isn't in the build env. Callers reach for the db only
// inside request handlers, where the env is always set.
type Db = ReturnType<typeof drizzle<typeof schemaAuth>>;

let cached: Db | null = null;

export function getDb(): Db {
  if (cached) return cached;
  const url = process.env["POSTGRES_URL"];
  if (!url) {
    throw new Error("POSTGRES_URL is not set");
  }
  cached = drizzle({
    client: postgres(url),
    schema: { ...schemaAuth },
    casing: "snake_case",
  });
  return cached;
}

export type { Db };
