import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { DbConnection } from "./connection";

/**
 * The committed SQL migrations live at `packages/db/drizzle/` next to this
 * source, and the prod bundle ships a copy beside the entry file — so the
 * folder is whichever of the two candidates exists.
 */
function resolveMigrationsFolder(): string {
  const candidates = [
    new URL("../drizzle", import.meta.url),
    new URL("./drizzle", import.meta.url),
  ].map((url) => fileURLToPath(url));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`migrations folder not found; looked at ${candidates.join(", ")}`);
  }
  return found;
}

/**
 * Apply the committed SQL migrations. Runs on every boot; already-applied
 * migrations are skipped by drizzle's own journal, so calling this is
 * idempotent.
 */
export function runMigrations(db: DbConnection): void {
  migrate(db, { migrationsFolder: resolveMigrationsFolder() });
}
