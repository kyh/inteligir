import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { DbConnection } from "./connection";
import { parseMigrationJournal } from "./migration-journal";

// a bundle that stages the folder elsewhere passes its own path; this package never probes
// another package's layout.
const SOURCE_MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

// every migration bumps meta.schema_version to its own generation, so the entry count is the
// version.
function latestSchemaVersion(migrationsFolder: string): number {
  const journalPath = join(migrationsFolder, "meta", "_journal.json");
  const journal = parseMigrationJournal(readFileSync(journalPath, "utf8"), journalPath);
  return journal.entries.length;
}

// returns the ceiling getSchemaVersion refuses above: an older build opening a newer database
// applies nothing and would otherwise read it as if it understood it.
export function runMigrations(db: DbConnection, migrationsFolder?: string): number {
  const folder = migrationsFolder ?? SOURCE_MIGRATIONS_FOLDER;
  // `PRAGMA foreign_keys=OFF` is a silent no-op inside a transaction, and drizzle wraps each
  // migration in one, so a table-rebuild's DROP of a parent would cascade-wipe its children.
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
}
