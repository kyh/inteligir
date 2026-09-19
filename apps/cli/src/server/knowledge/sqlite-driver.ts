// knowledge.db is its own file, not @repo/db's: the store is a wipe-and-rebuild
// cache whose recovery deletes the files, and that must never take durable state
// with it. opening never throws — a bad file falls through delete, rename-aside, memory.

import { mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
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

const openAt = (target: string): Database.Database => {
  const opened = new Database(target);
  try {
    // a corrupt file opens lazily; the pragma is what fails, inside the ladder.
    opened.pragma("journal_mode = WAL");
    // rebuildable from the vault, so a lost transaction on power loss costs a reconcile.
    opened.pragma("synchronous = NORMAL");
    return opened;
  } catch (error) {
    try {
      opened.close();
    } catch {
      // already unusable.
    }
    throw error;
  }
};

export const createSqliteDriver = (dbPath: string): SqlDriver => {
  try {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  } catch (error) {
    console.warn("[knowledge-db] cannot create data dir (using memory):", messageOf(error));
  }

  const deleteDbFiles = (): void => {
    for (const suffix of SIDE_SUFFIXES) {
      rmSync(`${dbPath}${suffix}`, { force: true });
    }
  };

  const renameDbFilesAside = (): void => {
    const stamp = Date.now();
    for (const suffix of SIDE_SUFFIXES) {
      try {
        renameSync(`${dbPath}${suffix}`, `${dbPath}${suffix}.corrupt-${stamp}`);
      } catch {
        // a missing side file, or a filesystem that refuses; the memory rung covers the latter.
      }
    }
  };

  const openBestEffort = (): OpenedIndexDb => {
    try {
      return { backing: "file", db: openAt(dbPath) };
    } catch (error) {
      console.warn("[knowledge-db] open failed — discarding the index file:", messageOf(error));
    }
    try {
      deleteDbFiles();
      return { backing: "file", db: openAt(dbPath) };
    } catch (error) {
      console.warn(
        "[knowledge-db] delete failed — renaming the corrupt files aside:",
        messageOf(error),
      );
    }
    try {
      renameDbFilesAside();
      return { backing: "file", db: openAt(dbPath) };
    } catch (error) {
      console.warn("[knowledge-db] file backing unusable — running in memory:", messageOf(error));
    }
    return { backing: "memory", db: openAt(":memory:") };
  };

  let { db, backing } = openBestEffort();
  // prepared statements are per-connection; the cache dies with it on reset.
  let statements = new Map<string, Database.Statement>();

  const prepared = (sql: string): Database.Statement => {
    const cached = statements.get(sql);
    if (cached !== undefined) {
      return cached;
    }
    const statement = db.prepare(sql);
    statements.set(sql, statement);
    return statement;
  };

  return {
    all(sql, params) {
      const rows: unknown[] = prepared(sql).all(...params);
      return rows.flatMap((row) => {
        const parsed = sqlRowSchema.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      });
    },

    close() {
      statements = new Map();
      db.close();
    },

    exec(sql) {
      db.exec(sql);
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
      } catch (error) {
        console.warn("[knowledge-db] reset delete failed — renaming aside:", messageOf(error));
        renameDbFilesAside();
      }
      ({ db, backing } = openBestEffort());
    },

    run(sql, params) {
      prepared(sql).run(...params);
    },
  };
};
