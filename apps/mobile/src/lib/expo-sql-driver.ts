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

// withExclusiveTransactionAsync answers nothing, so what `work` answers rides out beside it, read
// only once the commit has resolved
interface TransactionOutcome<T> {
  committed: { value: T } | null;
}

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

  // withExclusiveTransactionAsync runs `work` on a connection of its own, so a second transaction
  // would meet the first as locked rather than wait: every transaction takes the lock. a read does
  // not, and sees what the last commit left.
  return {
    all: async (sql, params) => await executorOver(await database()).all(sql, params),
    exclusive: async <T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> =>
      await serial(async () => {
        const db = await database();
        const outcome: TransactionOutcome<T> = { committed: null };
        await db.withExclusiveTransactionAsync(async (txn) => {
          outcome.committed = { value: await work(executorOver(txn)) };
        });
        if (outcome.committed === null) {
          throw new Error("The phone's database ended a transaction without running it.");
        }
        return outcome.committed.value;
      }),
  };
};
