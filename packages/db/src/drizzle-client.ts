import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schemaAuth from "./drizzle-schema-auth";

// Lazy connection — instantiating postgres() at module load makes
// `pnpm build` (which evaluates route handlers to collect page data) fail
// when POSTGRES_URL isn't in the build env. Defer to first use so the
// server runtime is the only place that needs the env var.
let cached: ReturnType<typeof drizzle<typeof schemaAuth>> | null = null;

function drizzleClient(): ReturnType<typeof drizzle<typeof schemaAuth>> {
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

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schemaAuth>>, {
  get(_target, prop, receiver) {
    return Reflect.get(drizzleClient(), prop, receiver);
  },
});

export type Db = typeof db;
