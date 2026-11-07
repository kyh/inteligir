// The replica engine's SQL over expo-sqlite: the one database file, in expo-sqlite's default
// directory under Documents (never Paths.cache, which iOS purges), kept out of the device backup
// since it downloads again, and in WAL from its open, so a read sees the last commit while a write
// runs on its own connection. Every write runs behind one lock in this process, a transaction
// through `withExclusiveTransactionAsync` on its `txn` (expo-sqlite gives each its own connection,
// so a second one at once would meet the first as locked rather than wait). Values are always
// bound, and a prepared statement is finalized in `finally` whatever its run did. Only the
// composition root imports this: it loads a native module.

import { openDatabaseAsync } from "expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";
import { serialLock } from "@repo/library-replica/serial-lock";
import type { ReplicaSql, ReplicaStatements } from "@repo/library-replica/replica-ports";
import type { SqlRow } from "@repo/notes/library/library-sql";
import { excludeFromBackup } from "./backup-exclusion";

const statementsOn = (db: SQLiteDatabase): ReplicaStatements => ({
  all: async (sql, params) => {
    const statement = await db.prepareAsync(sql);
    try {
      const result = await statement.executeAsync<SqlRow>([...params]);
      return await result.getAllAsync();
    } finally {
      await statement.finalizeAsync();
    }
  },
  run: async (sql, params) => {
    const statement = await db.prepareAsync(sql);
    try {
      await statement.executeAsync([...params]);
    } finally {
      await statement.finalizeAsync();
    }
  },
});

// withExclusiveTransactionAsync answers nothing, so what `work` answers rides out beside it, read
// only once the commit has resolved
interface TransactionOutcome<T> {
  committed: { readonly value: T } | null;
}

const directoryOf = (path: string): string => path.slice(0, path.lastIndexOf("/"));

export const openExpoReplicaSql = async (name: string): Promise<ReplicaSql> => {
  const db = await openDatabaseAsync(name);
  await db.execAsync("PRAGMA journal_mode = WAL");
  await excludeFromBackup(directoryOf(db.databasePath));
  const direct = statementsOn(db);
  const writes = serialLock();
  return {
    all: direct.all,
    exclusive: async <T>(work: (tx: ReplicaStatements) => Promise<T>): Promise<T> =>
      await writes(async () => {
        const outcome: TransactionOutcome<T> = { committed: null };
        await db.withExclusiveTransactionAsync(async (txn) => {
          outcome.committed = { value: await work(statementsOn(txn)) };
        });
        if (outcome.committed === null) {
          throw new Error("The phone's database ended a transaction without running it.");
        }
        return outcome.committed.value;
      }),
    run: async (sql, params) => {
      await writes(async () => {
        await direct.run(sql, params);
      });
    },
  };
};
