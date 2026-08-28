import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { DbConnection } from "./connection";
import { parseMigrationJournal } from "./migration-journal";

// The committed SQL migrations live at `packages/db/drizzle/`, next to this
// source. A deployment whose bundling moves the folder (the `inteligir`
// bundle stages it beside its entry) resolves its own layout and passes the
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
  const journalPath = join(migrationsFolder, "meta", "_journal.json");
  const journal = parseMigrationJournal(readFileSync(journalPath, "utf8"), journalPath);
  return journal.entries.length;
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
  // FK enforcement is suspended for the WINDOW, not the migration: drizzle
  // wraps each migration in a transaction, where a `PRAGMA foreign_keys=OFF`
  // statement is a silent no-op — so a table-rebuild migration's DROP of a
  // parent would run the implicit delete and CASCADE-WIPE its children (0007
  // rebuilds `threads`; the children are the entire event log). Turning the
  // pragma off out here, where it takes effect, is SQLite's own documented
  // alter recipe; the integrity check afterwards is what makes it safe —
  // a violated reference refuses the boot rather than opening a corrupt db.
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
