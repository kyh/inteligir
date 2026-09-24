// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import Database from "better-sqlite3";
import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

// no relation is declared: the graph exists so `db._.relations` carries every table, which is
// what drizzle 1.0 keys the schema-aware surfaces on (`schema` alone registers nothing).
const relations = defineRelations(schema);

export const SQLITE_BUSY_TIMEOUT_MS = 5000;

export type DbConnection = ReturnType<typeof createConnection>;
export type DbTransaction = Parameters<Parameters<DbConnection["transaction"]>[0]>[0];
export type DbExecutor = DbConnection | DbTransaction;

export const createConnection = (dbPath: string) => {
  const sqlite = new Database(dbPath);

  // only takes effect on a brand-new database; an existing one converts on its next full VACUUM.
  sqlite.pragma("auto_vacuum = INCREMENTAL");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // WAL + NORMAL: no fsync per commit; power loss can drop the last transactions, not corrupt
  // the file.
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);

  return drizzle({ client: sqlite, relations });
};

// a sync driver's transaction refuses an async callback at the type level, and this signature
// carries the same refusal so the guard survives the wrapper (a promise returned here would
// commit before its work ran).
// oxlint-disable-next-line typescript/no-explicit-any -- drizzle spells its guard `Promise<any>`, and a conditional type only relates to one with the identical extends type
type SyncWork<T> = (tx: DbTransaction) => T extends Promise<any> ? never : T;

// BEGIN IMMEDIATE takes the write lock up front, so a read-then-write cannot hit SQLITE_BUSY
// upgrading midway.
export const writeTransaction = <T>(db: DbConnection, work: SyncWork<T>): T =>
  db.transaction(work, { behavior: "immediate" });

// WAL leaves a `-wal` sidecar that only a clean close checkpoints away. auto_vacuum=INCREMENTAL
// only marks a deleted row's pages free; incremental_vacuum is what hands them back to the disk.
export const closeConnection = (db: DbConnection): void => {
  const sqlite = db.$client;
  if (!sqlite.open) {
    return;
  }
  try {
    sqlite.pragma("incremental_vacuum");
  } catch {
    // best effort: a file another writer holds keeps its free pages until the next close.
  }
  sqlite.close();
};
