/**
 * SPIKE: Docker-free Postgres for headless verification.
 *
 * `createTestDb()` returns a Drizzle client backed by PGlite — a full
 * Postgres engine compiled to WASM that runs in-process. No Docker daemon,
 * no Supabase CLI, no display required, so it works inside the ephemeral
 * cloud container that Claude-on-web uses.
 *
 * The real Drizzle schema is applied to the fresh database via drizzle-kit's
 * programmatic `pushSchema`, so tests exercise the actual tables, columns,
 * constraints and relations — not a hand-rolled stand-in.
 *
 * This mirrors the shape the production client (`drizzle-client.ts`) should
 * eventually take once it is converted from a singleton into a factory that
 * accepts an injectable driver. See docs/verification-architecture.md.
 */
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";

import * as schema from "../drizzle-schema";
import * as schemaAuth from "../drizzle-schema-auth";

const fullSchema = { ...schemaAuth, ...schema };

export type TestDb = ReturnType<typeof drizzle<typeof fullSchema>>;

export const createTestDb = async (): Promise<{
  db: TestDb;
  close: () => Promise<void>;
}> => {
  const client = new PGlite();
  const db = drizzle({ client, schema: fullSchema, casing: "snake_case" });

  // Apply the real schema to the empty database (DDL diff from nothing).
  const { pushSchema } = await import("drizzle-kit/api");
  const { apply } = await pushSchema(fullSchema, db as never);
  await apply();

  return {
    db,
    close: async () => {
      await client.close();
    },
  };
};
