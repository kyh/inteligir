// The suites' shared migrated-database fixture. db.test.ts deliberately does
// NOT use it — it opens un-migrated databases to test the migrator itself.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { createConnection, type DbConnection } from "../connection";
import { runMigrations } from "../migrate";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A fresh, fully-migrated database in its own temp dir, removed after the
 *  current test. */
export function openTempDb(): DbConnection {
  return openTempDbWithPath().db;
}

/** A migrated database in a scratch directory, and where it lives. */
export interface TempDb {
  db: DbConnection;
  databasePath: string;
}

/** Same, and WHERE it lives — for a suite that reopens the same file. */
export function openTempDbWithPath(): TempDb {
  const dir = mkdtempSync(join(tmpdir(), "inteligir-db-test-"));
  tempDirs.push(dir);
  const databasePath = join(dir, "test.db");
  const db = createConnection(databasePath);
  runMigrations(db);
  return { db, databasePath };
}
