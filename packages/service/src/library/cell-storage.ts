// The library cell's SQLite behind the port `@repo/service/library/library-sql` runs its plans over: `sql.exec`
// is synchronous and runs one statement a call, and a transaction is `transactionSync`, which
// commits when its work returns and rolls back when it throws
// (https://developers.cloudflare.com/durable-objects/api/sql-storage/). Every cursor is read to the
// end before the call returns, so none is held across an await.

import { LibraryRowError } from "./library-sql";
import { sqlRowSchema } from "./sql-value";
import type { SqlPort, SqlRow } from "./library-sql";

export interface CellStorage extends SqlPort {
  // what the cell's SQLite holds, its change sets included: one half of what the quota counts
  readonly databaseSize: () => number;
}

// a row as the cell's SQLite hands it back: the schema stores no BLOB column, so a byte value is a
// row this build never wrote
const rowOf = (raw: Record<string, SqlStorageValue>): SqlRow => {
  const row = sqlRowSchema.safeParse(raw);
  if (!row.success) {
    throw new LibraryRowError("a row holds bytes, which the library never stores", {
      cause: row.error,
    });
  }
  return row.data;
};

export const cellStorageOf = (storage: DurableObjectStorage): CellStorage => ({
  all: (sql, params) =>
    storage.sql
      .exec(sql, ...params)
      .toArray()
      .map(rowOf),
  databaseSize: () => storage.sql.databaseSize,
  run: (sql, params) => {
    // drained, not only stepped: a cursor left open would read past the next await
    storage.sql.exec(sql, ...params).toArray();
  },
  transaction: (work) => storage.transactionSync(work),
});
