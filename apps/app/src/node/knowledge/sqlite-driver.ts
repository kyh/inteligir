// The better-sqlite3 binding of @repo/notes' SqlDriver seam. The KnowledgeStore
// owns every statement (schema, guards, FTS5 queries); this module owns only
// the file lifecycle and the byte-level binding.
//
// The index lives in its OWN file (knowledge.db beside the app db), never in
// @repo/db's database: the store is a wipe-and-rebuild CACHE whose recovery
// primitive is "close + delete the files", which must never be able to take
// durable state with it. That is also why its tables have no drizzle
// migrations — the store's own version guards ARE the migration story.
//
// THE INDEX MUST NEVER ABORT PRODUCT BOOT. Opening runs a recovery ladder:
// open the file; on any failure delete the db files and open fresh; if the
// files cannot be deleted, rename them aside (timestamped) and open fresh; if
// even that fails, run in memory for this process — an empty index the boot
// reconcile rebuilds either way. Every downgrade is logged, none is thrown.
//
// `transaction` and `schemaVersion` stay unset on purpose: a file-backed
// binding wants the store's plain SQL path (BEGIN/COMMIT, PRAGMA user_version).

import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { SqlDriver, SqlRow } from "@repo/notes/knowledge/sql-knowledge-store";
import { messageOf } from "./message-of";

function isSqlRow(row: unknown): row is SqlRow {
  return typeof row === "object" && row !== null;
}

const SIDE_SUFFIXES = ["", "-wal", "-shm"] as const;

function openAt(target: string): Database.Database {
  const opened = new Database(target);
  try {
    // The pragmas double as the header check: a corrupt file opens lazily
    // and fails HERE, inside the ladder, not later in the store.
    opened.pragma("journal_mode = WAL");
    // The whole file is rebuildable from the vault, so a dropped
    // transaction on power loss costs a reconcile, never data.
    opened.pragma("synchronous = NORMAL");
    return opened;
  } catch (err) {
    try {
      opened.close();
    } catch {
      // Already unusable.
    }
    throw err;
  }
}

/** Open (creating if absent) the knowledge database at `dbPath`. Never
 * throws for a bad file — see the recovery ladder above. */
export function createSqliteDriver(dbPath: string): SqlDriver {
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
  } catch (err) {
    console.warn("[knowledge-db] cannot create data dir (using memory):", messageOf(err));
  }

  function deleteDbFiles(): void {
    for (const suffix of SIDE_SUFFIXES) rmSync(`${dbPath}${suffix}`, { force: true });
  }

  function renameDbFilesAside(): void {
    const stamp = Date.now();
    for (const suffix of SIDE_SUFFIXES) {
      try {
        renameSync(`${dbPath}${suffix}`, `${dbPath}${suffix}.corrupt-${stamp}`);
      } catch {
        // A missing side file, or a filesystem that refuses — the ladder's
        // next rung (memory) covers the latter.
      }
    }
  }

  /** The recovery ladder: file → delete-and-retry → rename-aside-and-retry →
   * memory. Never throws. */
  function openBestEffort(): { db: Database.Database; backing: "file" | "memory" } {
    try {
      return { db: openAt(dbPath), backing: "file" };
    } catch (err) {
      console.warn("[knowledge-db] open failed — discarding the index file:", messageOf(err));
    }
    try {
      deleteDbFiles();
      return { db: openAt(dbPath), backing: "file" };
    } catch (err) {
      console.warn(
        "[knowledge-db] delete failed — renaming the corrupt files aside:",
        messageOf(err),
      );
    }
    try {
      renameDbFilesAside();
      return { db: openAt(dbPath), backing: "file" };
    } catch (err) {
      console.warn("[knowledge-db] file backing unusable — running in memory:", messageOf(err));
    }
    return { db: openAt(":memory:"), backing: "memory" };
  }

  let { db, backing } = openBestEffort();
  // Prepared statements are per-connection; the cache dies with it on reset.
  let statements = new Map<string, Database.Statement>();

  function prepared(sql: string): Database.Statement {
    const cached = statements.get(sql);
    if (cached !== undefined) return cached;
    const statement = db.prepare(sql);
    statements.set(sql, statement);
    return statement;
  }

  return {
    exec(sql) {
      db.exec(sql);
    },

    run(sql, params) {
      prepared(sql).run(...params);
    },

    all(sql, params) {
      const rows: unknown[] = prepared(sql).all(...params);
      return rows.filter(isSqlRow);
    },

    reset() {
      statements = new Map();
      try {
        db.close();
      } catch {
        // Already unusable — the point of reset is to leave it behind.
      }
      if (backing === "memory") {
        db = openAt(":memory:");
        return;
      }
      try {
        deleteDbFiles();
      } catch (err) {
        console.warn("[knowledge-db] reset delete failed — renaming aside:", messageOf(err));
        renameDbFilesAside();
      }
      ({ db, backing } = openBestEffort());
    },

    close() {
      statements = new Map();
      db.close();
    },
  };
}
