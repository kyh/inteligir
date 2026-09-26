// the port over expo-sqlite, opened on the first call so the composition stays synchronous; a
// failed open fails every call after it. only the composition root imports this: it loads native
// modules.

import { openDatabaseAsync } from "expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";
import { excludeFromBackup } from "./backup-exclusion";
import { createSerialLock } from "./sql-driver";
import type { SqlDriver, SqlExecutor } from "./sql-driver";

const executorOver = (db: SQLiteDatabase): SqlExecutor => ({
  all: async (sql, params = []) => await db.getAllAsync<unknown>(sql, [...params]),
  exec: async (sql) => {
    await db.execAsync(sql);
  },
  run: async (sql, params = []) => {
    await db.runAsync(sql, [...params]);
  },
});

const directoryOf = (path: string): string => path.slice(0, path.lastIndexOf("/"));

const openPrepared = async (name: string): Promise<SQLiteDatabase> => {
  const db = await openDatabaseAsync(name);
  await db.execAsync("PRAGMA journal_mode = WAL");
  await excludeFromBackup(directoryOf(db.databasePath));
  return db;
};

// in expo-sqlite's default directory under Documents, never Paths.cache: iOS purges a cache under
// storage pressure, and what this file holds must outlive a relaunch offline
export const createExpoSqlDriver = (name: string): SqlDriver => {
  let opened: Promise<SQLiteDatabase> | null = null;
  const database = async (): Promise<SQLiteDatabase> => {
    opened ??= openPrepared(name);
    return await opened;
  };
  const serial = createSerialLock();

  // withExclusiveTransactionAsync runs `work` on a connection of its own, so a write on the shared
  // one mid-transaction would fail as locked rather than wait: every write takes the lock. a read
  // does not, and sees what the last commit left.
  return {
    all: async (sql, params) => await executorOver(await database()).all(sql, params),
    exclusive: async (work) =>
      await serial(async () => {
        const db = await database();
        await db.withExclusiveTransactionAsync(async (txn) => {
          await work(executorOver(txn));
        });
      }),
    exec: async (sql) => {
      await serial(async () => {
        const db = await database();
        await executorOver(db).exec(sql);
      });
    },
    run: async (sql, params) => {
      await serial(async () => {
        const db = await database();
        await executorOver(db).run(sql, params);
      });
    },
  };
};
