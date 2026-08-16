// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export type DbConnection = ReturnType<typeof createConnection>;

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
