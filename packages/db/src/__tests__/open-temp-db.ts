import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { onTestFinished } from "vitest";
import { createConnection } from "../connection";
import type { DbConnection } from "../connection";
import { runMigrations } from "../migrate";

// vitest runs onTestFinished hooks in reverse order, so anything created inside is disposed
// before the dir.
export const makeTempDir = (prefix: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  onTestFinished(() => {
    rmSync(dir, { force: true, recursive: true });
  });
  return dir;
};

export interface TempDb {
  db: DbConnection;
  databasePath: string;
}

export const openTempDbWithPath = (): TempDb => {
  const databasePath = path.join(makeTempDir("inteligir-db-test-"), "test.db");
  const db = createConnection(databasePath);
  runMigrations(db);
  return { databasePath, db };
};

export const openTempDb = (): DbConnection => openTempDbWithPath().db;
