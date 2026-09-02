import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { createConnection, type DbConnection } from "../connection";
import { runMigrations } from "../migrate";

// vitest runs onTestFinished hooks in reverse order, so anything created inside is disposed
// before the dir.
export function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

export function openTempDb(): DbConnection {
  return openTempDbWithPath().db;
}

export interface TempDb {
  db: DbConnection;
  databasePath: string;
}

export function openTempDbWithPath(): TempDb {
  const databasePath = join(makeTempDir("inteligir-db-test-"), "test.db");
  const db = createConnection(databasePath);
  runMigrations(db);
  return { db, databasePath };
}
