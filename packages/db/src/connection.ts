// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export type DbConnection = ReturnType<typeof createConnection>;
export type DbTransaction = Parameters<Parameters<DbConnection["transaction"]>[0]>[0];

export function createConnection(dbPath: string) {
  const sqlite = new Database(dbPath);

  // only takes effect on a brand-new database; an existing one converts on its next full VACUUM.
  sqlite.pragma("auto_vacuum = INCREMENTAL");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // WAL + NORMAL: no fsync per commit; power loss can drop the last transactions, not corrupt
  // the file.
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);

  return drizzle({ client: sqlite, schema });
}

// BEGIN IMMEDIATE takes the write lock up front, so a read-then-write cannot hit SQLITE_BUSY
// upgrading midway.
export function writeTransaction<T>(db: DbConnection, work: (tx: DbTransaction) => T): T {
  return db.transaction(work, { behavior: "immediate" });
}

// WAL leaves a `-wal` sidecar that only a clean close checkpoints away.
export function closeConnection(db: DbConnection): void {
  db.$client.close();
}
