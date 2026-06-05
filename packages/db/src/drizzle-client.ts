import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schemaAuth from "./drizzle-schema-auth";

type Db = ReturnType<typeof drizzle<typeof schemaAuth>>;

let cached: Db | null = null;

export function getDb(): Db {
  if (cached) return cached;
  const url = process.env["TURSO_DATABASE_URL"];
  if (!url) {
    throw new Error("TURSO_DATABASE_URL is not set");
  }
  const client = createClient({
    url,
    authToken: process.env["TURSO_AUTH_TOKEN"],
  });
  cached = drizzle({
    client,
    schema: { ...schemaAuth },
    casing: "snake_case",
  });
  return cached;
}

export type { Db };
