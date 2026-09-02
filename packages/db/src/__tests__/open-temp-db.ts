// The suites' shared scratch directory and migrated-database fixture.
// db.test.ts opens its OWN databases — un-migrated, to test the migrator
// itself — over the same directory helper.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { createConnection, type DbConnection } from "../connection";
import { runMigrations } from "../migrate";

/** A fresh temp dir, removed when the current test finishes — after anything
 *  the test created inside it, since those register their disposal later. */
export function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/** A fresh, fully-migrated database in its own temp dir. */
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
  const databasePath = join(makeTempDir("inteligir-db-test-"), "test.db");
  const db = createConnection(databasePath);
  runMigrations(db);
  return { db, databasePath };
}
