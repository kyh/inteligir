import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { DbConnection } from "./connection";

/**
 * Apply the committed SQL migrations (`packages/db/drizzle/`). Runs on every
 * boot; already-applied migrations are skipped by drizzle's own journal, so
 * calling this is idempotent.
 */
export function runMigrations(db: DbConnection): void {
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
  migrate(db, { migrationsFolder });
}
