// knowledge.db is its own file, not @repo/db's: the store is a wipe-and-rebuild
// cache whose recovery deletes the files, and that must never take durable state
// with it. opening never throws — a bad file falls through delete, rename-aside, memory.

import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { SqlDriver } from "@repo/notes/knowledge/sql-knowledge-store";
import { z } from "zod";
import { messageOf } from "../error-message";

const sqlRowSchema = z.record(z.string(), z.union([z.null(), z.number(), z.string()]));

interface OpenedIndexDb {
  db: Database.Database;
  backing: "file" | "memory";
}

const SIDE_SUFFIXES = ["", "-wal", "-shm"] as const;

function openAt(target: string): Database.Database {
  const opened = new Database(target);
  try {
    // a corrupt file opens lazily; the pragma is what fails, inside the ladder.
    opened.pragma("journal_mode = WAL");
    // rebuildable from the vault, so a lost transaction on power loss costs a reconcile.
    opened.pragma("synchronous = NORMAL");
    return opened;
  } catch (err) {
    try {
      opened.close();
    } catch {
      // already unusable.
    }
    throw err;
  }
}

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
        // a missing side file, or a filesystem that refuses; the memory rung covers the latter.
      }
    }
  }

  function openBestEffort(): OpenedIndexDb {
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
  // prepared statements are per-connection; the cache dies with it on reset.
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
      return rows.flatMap((row) => {
        const parsed = sqlRowSchema.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      });
    },

    reset() {
      statements = new Map();
      try {
        db.close();
      } catch {
        // already unusable.
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
