// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export type DbConnection = ReturnType<typeof createConnection>;
export type DbTransaction = Parameters<Parameters<DbConnection["transaction"]>[0]>[0];

export function createConnection(dbPath: string) {
  const sqlite = new Database(dbPath);

  // Reclaim freed pages incrementally instead of relying on a full-file
  // VACUUM. Only takes effect for a brand-new database (set before any tables
  // exist); existing databases convert on their next full VACUUM.
  sqlite.pragma("auto_vacuum = INCREMENTAL");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // WAL + NORMAL: no fsync per commit. Power loss can drop the last
  // transactions; it cannot corrupt the file.
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);

  return drizzle({ client: sqlite, schema });
}

/**
 * Every WRITE transaction in this codebase, one spelling. `BEGIN IMMEDIATE`
 * takes the write lock up front, so a read-then-write inside the transaction
 * cannot hit SQLITE_BUSY upgrading midway — and the one-transaction-ingest
 * law is structural rather than a per-call-site option a new writer can
 * forget.
 */
export function writeTransaction<T>(db: DbConnection, work: (tx: DbTransaction) => T): T {
  return db.transaction(work, { behavior: "immediate" });
}

/**
 * Close the underlying handle. WAL leaves a `-wal` sidecar that only a clean
 * close checkpoints away, so the shutdown path calls this rather than letting
 * process exit drop the file descriptor.
 */
export function closeConnection(db: DbConnection): void {
  db.$client.close();
}
