import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { DbConnection } from "./connection";

// The committed SQL migrations live at `packages/db/drizzle/`, next to this
// source. A deployment whose bundling moves the folder (apps/app's prod
// bundle copies it beside its entry) resolves its own layout and passes the
// path in — this package never probes for another package's file layout.
const SOURCE_MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * The generation THIS BUILD's migrations end at, read from drizzle's own
 * journal so it cannot drift from the folder that was applied. Each migration
 * bumps `meta.schema_version` to its own generation (pinned by
 * `__tests__/schema-agreement.test.ts`), so the entry count IS the version a
 * fully-migrated database should be on.
 */
function latestSchemaVersion(migrationsFolder: string): number {
  const raw: unknown = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  );
  const entries = typeof raw === "object" && raw !== null ? Reflect.get(raw, "entries") : undefined;
  if (!Array.isArray(entries)) {
    throw new Error(`${migrationsFolder}/meta/_journal.json has no "entries" array`);
  }
  return entries.length;
}

/**
 * Apply the committed SQL migrations. Runs on every boot; already-applied
 * migrations are skipped by drizzle's own journal, so calling this is
 * idempotent. Returns the generation this build's migrations reach, which is
 * the ceiling `getSchemaVersion` refuses above — a build never applies a
 * migration it does not carry, so an OLDER build opening a NEWER database
 * applies nothing at all and would otherwise read it as if it understood it.
 */
export function runMigrations(db: DbConnection, migrationsFolder?: string): number {
  const folder = migrationsFolder ?? SOURCE_MIGRATIONS_FOLDER;
  migrate(db, { migrationsFolder: folder });
  return latestSchemaVersion(folder);
}
