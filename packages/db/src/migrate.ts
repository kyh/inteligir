import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { count } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { DbConnection } from "./connection";

// a bundle that stages the folder elsewhere passes its own path; this package never probes
// another package's layout.
const SOURCE_MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

const MIGRATIONS_TABLE = "__drizzle_migrations";

// drizzle's own ledger, read before its migrator runs; only the column the check needs.
const migrationsLedger = sqliteTable(MIGRATIONS_TABLE, { name: text("name") });

// one folder per generation, `<yyyymmddhhmmss>_<name>/migration.sql`, ordered by name — the
// same read drizzle's migrator does, so the ceiling and the applied set count the same folders.
export const listMigrationNames = (migrationsFolder: string): string[] =>
  readdirSync(migrationsFolder)
    .filter((entry) => existsSync(path.join(migrationsFolder, entry, "migration.sql")))
    .toSorted((a, b) => a.localeCompare(b));

// thrown before drizzle runs, which would otherwise apply the baseline over tables the file
// already holds; the server replaces such a file at boot (`apps/cli/src/server/open-database.ts`).
export class UnknownMigrationHistoryError extends Error {
  readonly unknown: readonly string[];

  constructor(databasePath: string, unknown: readonly string[]) {
    super(
      `${databasePath} was migrated through ${unknown.join(", ")}, which this build does not ` +
        `carry, so it cannot be upgraded in place: wipe it (with its -wal and -shm) and restart, ` +
        `and a fresh one is created.`,
    );
    this.name = "UnknownMigrationHistoryError";
    this.unknown = unknown;
  }
}

// a row with no name is one this build's migrator never wrote.
const UNNAMED = "(unnamed)";

const appliedMigrationNames = (db: DbConnection): string[] => {
  const ledger = db.$client
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE);
  if (ledger === undefined) {
    return [];
  }
  const named = db.$client
    .prepare(`SELECT * FROM "${MIGRATIONS_TABLE}"`)
    .columns()
    .some((column) => column.name === "name");
  if (!named) {
    const rows = db.select({ value: count() }).from(migrationsLedger).get()?.value ?? 0;
    return rows > 0 ? [UNNAMED] : [];
  }
  return db
    .select({ name: migrationsLedger.name })
    .from(migrationsLedger)
    .all()
    .map((row) => row.name ?? UNNAMED);
};

// an unknown name after the newest known one is a newer build's, which getSchemaVersion's
// ceiling refuses in its own words; before it, the file is on a history this build lacks.
const assertKnownHistory = (db: DbConnection, known: readonly string[], latest: string): void => {
  const knownSet = new Set(known);
  const unknown = appliedMigrationNames(db).filter(
    (name) => !knownSet.has(name) && (name === UNNAMED || name.localeCompare(latest) < 0),
  );
  if (unknown.length > 0) {
    throw new UnknownMigrationHistoryError(db.$client.name, [...new Set(unknown)]);
  }
};

// returns the ceiling getSchemaVersion refuses above: an older build opening a newer database
// applies nothing and would otherwise read it as if it understood it. every migration bumps
// meta.schema_version to its own generation, so the folder count is the version.
export const runMigrations = (db: DbConnection, migrationsFolder?: string): number => {
  const folder = migrationsFolder ?? SOURCE_MIGRATIONS_FOLDER;
  const known = listMigrationNames(folder);
  const latest = known.at(-1);
  if (latest === undefined) {
    throw new Error(`${folder} holds no migration folders`);
  }
  assertKnownHistory(db, known, latest);
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
  return known.length;
};
