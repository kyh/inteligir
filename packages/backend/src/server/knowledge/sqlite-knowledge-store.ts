// ---------------------------------------------------------------------------
// node:sqlite binding for the shared SQL knowledge store. The schema, guards,
// and every query live in @repo/notes (sql-knowledge-store.ts, driver-injected)
// so the dev harness's wasm binding runs the identical engine; this module
// only supplies the node byte-level driver and the per-vault cache location.
//
// The DB lives OUTSIDE the vault — ~/.inteligir/indexes/<hash>.sqlite — so a
// cloud-synced vault folder (iCloud/Dropbox) never churns a live WAL file, it
// never appears in sync manifests or the sidebar, and logout's app-state wipe
// discards it harmlessly. THE DB IS A CACHE: nothing durable ever lives in
// index.sqlite (durable state belongs in ~/.inteligir JsonStores) — that
// invariant is what makes every recovery path a safe delete-and-rebuild.
//
// node:sqlite is Node's built-in module (zero native deps, no
// electron-rebuild); Electron pins the Node version per release, so the
// narrow API used here (DatabaseSync/prepare/exec) is stable per app version.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import type { KnowledgeStore } from "@repo/notes/knowledge/knowledge-store";
import { createSqlKnowledgeStore, type SqlDriver } from "@repo/notes/knowledge/sql-knowledge-store";

import { inteligirPath, shortPathKey } from "../storage/json-store";

/** Per-vault index DB path, keyed by a short hash of the vault root (mirrors
 * sync-manager's baseStorePath pattern — roots contain `/`). */
export function indexDbPathFor(root: string): string {
  return inteligirPath("indexes", `${shortPathKey(root)}.sqlite`);
}

const IN_MEMORY = ":memory:";

/** Delete the DB plus its WAL/SHM siblings — a partial trio is corruption. */
function deleteDbFiles(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== IN_MEMORY) fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  // WAL keeps index writes off the readers' path; a no-op for :memory:.
  db.exec("PRAGMA journal_mode = WAL");
  // NORMAL skips the per-commit fsync (FULL) that dominates small upsert
  // transactions. Safe by the cache law: the worst a power loss can produce
  // is a corrupt file, and openDatabaseRecovering / the store's open guards
  // already wipe-and-rebuild on any unreadable DB.
  db.exec("PRAGMA synchronous = NORMAL");
  if (dbPath !== IN_MEMORY) {
    // The db body column is the only full plaintext copy of every note (private
    // ones included) — own it 0600 at creation, not just at the next boot's
    // hardenAppDir sweep. WAL/SHM are created by the driver on first write.
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.chmodSync(`${dbPath}${suffix}`, 0o600);
      } catch {
        // -wal/-shm may not exist yet; the boot sweep is the backstop.
      }
    }
  }
  return db;
}

/** Open, recovering from an unopenable file (garbage bytes, truncation) by
 * deleting and starting empty — the cache contract makes that always safe. */
function openDatabaseRecovering(dbPath: string): DatabaseSync {
  try {
    return openDatabase(dbPath);
  } catch (err) {
    if (dbPath === IN_MEMORY) throw err;
    console.warn(`[knowledge] could not open ${dbPath} — recreating:`, err);
    deleteDbFiles(dbPath);
    return openDatabase(dbPath);
  }
}

function createNodeSqliteDriver(dbPath: string): SqlDriver {
  let db = openDatabaseRecovering(dbPath);
  // Statements are cached per SQL text; the cache dies with the connection.
  let statements = new Map<string, StatementSync>();
  const prepare = (sql: string): StatementSync => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };
  const closeQuietly = (): void => {
    statements = new Map();
    try {
      db.close();
    } catch {
      // Already closed — reset() after a failed open, or a double dispose.
    }
  };
  return {
    exec: (sql) => {
      db.exec(sql);
    },
    run: (sql, params) => {
      prepare(sql).run(...params);
    },
    all: (sql, params) => prepare(sql).all(...params),
    reset: () => {
      closeQuietly();
      // NEVER unlink for :memory: — closing the handle already dropped it.
      if (dbPath !== IN_MEMORY) deleteDbFiles(dbPath);
      db = openDatabase(dbPath);
    },
    close: closeQuietly,
  };
}

/** The desktop KnowledgeStore: core's SQL store over node:sqlite at `dbPath`
 * (`":memory:"` supported for tests), guarded against `vaultRoot`. */
export function createSqliteKnowledgeStore(dbPath: string, vaultRoot: string): KnowledgeStore {
  return createSqlKnowledgeStore(createNodeSqliteDriver(dbPath), vaultRoot);
}
