// The replica engine's SQL over node's own sqlite, so the phone's suites and its e2e run the phone's
// runtime over a real file. One connection: a statement issued while a transaction is open would
// join it, so every call queues behind the one before, as the phone's own reads wait out nothing
// half done. Values are always bound.

import { DatabaseSync } from "node:sqlite";
import type { ReplicaSql, ReplicaStatements } from "@repo/library-replica/replica-ports";
import { serialLock } from "@repo/library-replica/serial-lock";
import { sqlRowSchema } from "@repo/notes/library/sql-value";
import type { SqlRow, SqlValue } from "@repo/notes/library/library-sql";
import { z } from "zod";
import { settle } from "./settle";

// node answers a column as its own value type; the library's schema stores no blob and no bigint,
// so anything else is a file this runtime did not write
const rowsSchema = z.array(sqlRowSchema);

const bound = (params: readonly SqlValue[]): SqlValue[] => [...params];

export interface NodeReplicaSql extends ReplicaSql {
  readonly close: () => void;
}

export const openNodeReplicaSql = (path: string): NodeReplicaSql => {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  const serial = serialLock();

  const direct: ReplicaStatements = {
    all: async (sql, params): Promise<readonly SqlRow[]> =>
      await settle(() => rowsSchema.parse(db.prepare(sql).all(...bound(params)))),
    run: async (sql, params) => {
      await settle(() => db.prepare(sql).run(...bound(params)));
    },
  };

  return {
    all: async (sql, params) => await serial(async () => await direct.all(sql, params)),
    close: () => {
      db.close();
    },
    exclusive: async <T>(work: (tx: ReplicaStatements) => Promise<T>): Promise<T> =>
      await serial(async () => {
        db.exec("BEGIN IMMEDIATE");
        let value: T;
        try {
          value = await work(direct);
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        db.exec("COMMIT");
        return value;
      }),
    run: async (sql, params) => {
      await serial(async () => {
        await direct.run(sql, params);
      });
    },
  };
};
