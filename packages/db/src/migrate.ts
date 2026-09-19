import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { DbConnection } from "./connection";

// a bundle that stages the folder elsewhere passes its own path; this package never probes
// another package's layout.
const SOURCE_MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

// one folder per generation, `<yyyymmddhhmmss>_<name>/migration.sql`, ordered by name — the
// same read drizzle's migrator does, so the ceiling and the applied set count the same folders.
export const listMigrationNames = (migrationsFolder: string): string[] =>
  readdirSync(migrationsFolder)
    .filter((entry) => existsSync(path.join(migrationsFolder, entry, "migration.sql")))
    .toSorted((a, b) => a.localeCompare(b));

// every migration bumps meta.schema_version to its own generation, so the folder count is the
// version.
const latestSchemaVersion = (migrationsFolder: string): number => {
  const count = listMigrationNames(migrationsFolder).length;
  if (count === 0) {
    throw new Error(`${migrationsFolder} holds no migration folders`);
  }
  return count;
};

// returns the ceiling getSchemaVersion refuses above: an older build opening a newer database
// applies nothing and would otherwise read it as if it understood it.
export const runMigrations = (db: DbConnection, migrationsFolder?: string): number => {
  const folder = migrationsFolder ?? SOURCE_MIGRATIONS_FOLDER;
  // `PRAGMA foreign_keys=OFF` is a silent no-op inside a transaction, and drizzle wraps the
  // migrations in one, so a table-rebuild's DROP of a parent would cascade-wipe its children.
  // off out here is sqlite's alter recipe; the check afterwards refuses the boot on a violation.
  db.$client.pragma("foreign_keys = OFF");
  try {
    migrate(db, { migrationsFolder: folder });
  } finally {
    db.$client.pragma("foreign_keys = ON");
  }
  const violations = db.$client.pragma("foreign_key_check");
  if (Array.isArray(violations) && violations.length > 0) {
    throw new Error(
      `migrations left ${violations.length} foreign-key violation(s) — refusing to open the database`,
    );
  }
  return latestSchemaVersion(folder);
};
