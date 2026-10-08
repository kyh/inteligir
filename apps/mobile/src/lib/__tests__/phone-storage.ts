// the phone's stores for the tests: the SQL port over a real file and node's SHA-1

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { onTestFinished } from "vitest";
import { createSqliteSyncStore } from "../../sync/sqlite-sync-store";
import type { Sha1 } from "../../sync/sqlite-sync-store";
import type { SyncStore } from "../../sync/sync-store";
import { openNodeSqlDriver } from "../node-sql-driver";
import type { SqlDriver } from "../sql-driver";

// a database file of its own, removed when the test ends; open it again to relaunch
export const tempDbPath = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "inteligir-phone-"));
  onTestFinished(() => {
    rmSync(dir, { force: true, recursive: true });
  });
  return path.join(dir, "inteligir.db");
};

export const openTempDb = (file: string = tempDbPath()) => {
  const db = openNodeSqlDriver(file);
  onTestFinished(() => {
    db.close();
  });
  return db;
};

export const nodeSha1: Sha1 = async (bytes) => createHash("sha1").update(bytes).digest();

// the synced threads over a database file; reset it "restored" to read back what a file holds
export const openSyncStore = (db: SqlDriver = openTempDb()): SyncStore =>
  createSqliteSyncStore({ db, sha1: nodeSha1 });
