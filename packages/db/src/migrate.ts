import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { DbConnection } from "./connection";

// The committed SQL migrations live at `packages/db/drizzle/`, next to this
// source. A deployment whose bundling moves the folder (apps/app's prod
// bundle copies it beside its entry) resolves its own layout and passes the
// path in — this package never probes for another package's file layout.
const SOURCE_MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * Apply the committed SQL migrations. Runs on every boot; already-applied
 * migrations are skipped by drizzle's own journal, so calling this is
 * idempotent.
 */
export function runMigrations(db: DbConnection, migrationsFolder?: string): void {
  migrate(db, { migrationsFolder: migrationsFolder ?? SOURCE_MIGRATIONS_FOLDER });
}
