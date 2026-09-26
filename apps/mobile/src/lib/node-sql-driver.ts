// the port over node's own sqlite, so the tests run the phone's SQL against a real file. one
// connection: a statement issued while a transaction is open would join it, so the driver's own
// statements queue behind the transaction as they would wait on the phone's second connection.

import { DatabaseSync } from "node:sqlite";
import { settle } from "./settle";
import { createSerialLock } from "./sql-driver";
import type { SqlDriver, SqlExecutor } from "./sql-driver";

export const openNodeSqlDriver = (path: string): SqlDriver & { close: () => void } => {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  const serial = createSerialLock();

  const direct: SqlExecutor = {
    all: async (sql, params = []) => await settle(() => db.prepare(sql).all(...params)),
    exec: async (sql) => {
      await settle(() => {
        db.exec(sql);
      });
    },
    run: async (sql, params = []) => {
      await settle(() => db.prepare(sql).run(...params));
    },
  };

  return {
    all: async (sql, params) => await serial(async () => await direct.all(sql, params)),
    close: () => {
      db.close();
    },
    exclusive: async (work) =>
      await serial(async () => {
        db.exec("BEGIN IMMEDIATE");
        try {
          await work(direct);
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        db.exec("COMMIT");
      }),
    exec: async (sql) => {
      await serial(async () => {
        await direct.exec(sql);
      });
    },
    run: async (sql, params) => {
      await serial(async () => {
        await direct.run(sql, params);
      });
    },
  };
};
