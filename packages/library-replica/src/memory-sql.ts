// A replica's database in memory: SQLite's own wasm build (`@sqlite.org/sqlite-wasm`), FTS5
// included, the one the library's shared SQL is tested on in `@repo/notes`. The browser tab
// holds its replica here, online only, and pulls it again on every load; the suites run every
// replica engine test over it. One connection serves every call in order, so a statement outside
// a transaction waits out a running one, and a transaction is BEGIN IMMEDIATE to COMMIT around
// `work`, rolled back when it throws.

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import type { SqlRow } from "@repo/notes/library/library-sql";
import { z } from "zod";

import type { ReplicaSql, ReplicaStatements } from "./replica-ports";
import { serialLock } from "./serial-lock";

// the wasm loads once a page, on the first database asked for
let loading: Promise<Sqlite3Static> | null = null;

const rowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

export interface MemorySql extends ReplicaSql {
  readonly close: () => void;
}

export const openMemorySql = async (): Promise<MemorySql> => {
  loading ??= sqlite3InitModule();
  const sqlite3 = await loading;
  const db = new sqlite3.oo1.DB(":memory:", "c");
  const serial = serialLock();
  const statements: ReplicaStatements = {
    all: async (sql, params) =>
      await Promise.resolve(
        db.selectObjects(sql, [...params]).map((row): SqlRow => rowSchema.parse(row)),
      ),
    run: async (sql, params) => {
      db.exec({ bind: [...params], sql });
      await Promise.resolve();
    },
  };
  return {
    all: async (sql, params) => await serial(async () => await statements.all(sql, params)),
    close: () => {
      db.close();
    },
    exclusive: async (work) =>
      await serial(async () => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const value = await work(statements);
          db.exec("COMMIT");
          return value;
        } catch (error) {
          // SQLite rolls some failures back itself; one it left open is rolled back here
          if (sqlite3.capi.sqlite3_get_autocommit(db) === 0) {
            db.exec("ROLLBACK");
          }
          throw error;
        }
      }),
    run: async (sql, params) => {
      await serial(async () => {
        await statements.run(sql, params);
      });
    },
  };
};
