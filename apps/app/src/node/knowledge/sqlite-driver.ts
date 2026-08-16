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
// `transaction` and `schemaVersion` stay unset on purpose: a file-backed
// binding wants the store's plain SQL path (BEGIN/COMMIT, PRAGMA user_version).

import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { SqlDriver, SqlRow } from "@repo/notes/knowledge/sql-knowledge-store";

function isSqlRow(row: unknown): row is SqlRow {
  return typeof row === "object" && row !== null;
}

/** Open (creating if absent) the knowledge database at `dbPath`. */
export function createSqliteDriver(dbPath: string): SqlDriver {
  mkdirSync(dirname(dbPath), { recursive: true });

  let db = open();
  // Prepared statements are per-connection; the cache dies with it on reset.
  let statements = new Map<string, Database.Statement>();

  function open(): Database.Database {
    const opened = new Database(dbPath);
    opened.pragma("journal_mode = WAL");
    // The whole file is rebuildable from the vault, so a dropped transaction
    // on power loss costs a reconcile, never data.
    opened.pragma("synchronous = NORMAL");
    return opened;
  }

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
      db.close();
      for (const suffix of ["", "-wal", "-shm"]) {
        rmSync(`${dbPath}${suffix}`, { force: true });
      }
      db = open();
    },

    close() {
      statements = new Map();
      db.close();
    },
  };
}
