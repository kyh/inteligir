// ---------------------------------------------------------------------------
// Durable Object storage binding for the shared SQL knowledge store. The
// schema, the guards, the FTS5 bm25 ranking and every query live in @repo/notes
// (sql-knowledge-store.ts, driver-injected); this module supplies only the
// byte-level binding, so production search ranks exactly like the wasm-driven
// one the workspace's own tests drive.
//
// Three things about `ctx.storage.sql` shape it, and each one is why a member
// below exists rather than being inherited:
//
//   1. It is SYNCHRONOUS (`exec` returns a materialized cursor), which is what
//      lets it satisfy the store's synchronous contract at all.
//   2. It REFUSES `BEGIN`/`SAVEPOINT` — the object owns write coalescing and
//      offers `transactionSync` instead, which also rolls back on a throw.
//   3. It answers SQLITE_AUTH to `PRAGMA user_version`, so the schema version
//      lives in a driver-owned row.
//
// And one thing about the OBJECT shapes `reset()`: this database is shared with
// the vault manifest, which is durable state. The store's law is that its own
// tables are a cache safe to drop at any moment; the manifest's is the exact
// opposite. So the driver records every table the store creates and drops
// exactly those — never a table it did not make, and never by a hardcoded list
// that could fall behind the core schema.
//
// COST NOTE, because it is not visible from the SQL: Durable Object SQLite
// bills rows written, and every index row an INSERT touches counts as another
// one. `search_fts` is FTS5, whose shadow tables turn one document into a row
// per distinct term — so a full re-index costs a multiple of the document count
// in billed writes, not the document count. That is the reason the shell
// projects at write time and diffs content hashes instead of re-indexing.
// ---------------------------------------------------------------------------

import type { SqlDriver, SqlRow } from "@repo/notes/knowledge/sql-knowledge-store";

/** Tables this driver owns. Prefixed so they can never collide with the core
 * schema's unprefixed names or with the vault manifest's. */
const OBJECTS_TABLE = "knowledge_objects";
const DRIVER_META_TABLE = "knowledge_driver";

const SCHEMA_VERSION_KEY = "schema_version";

/** A `CREATE TABLE` / `CREATE VIRTUAL TABLE` name in a statement the store
 * hands to `exec`. Indexes are not tracked: SQLite drops a table's indexes with
 * it, and a virtual table cannot carry one. */
const CREATE_TABLE_RE = /\bCREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;

/**
 * Bind core's SQL knowledge store to a Durable Object's own SQLite.
 *
 * The database is the object's, not the driver's, so `close()` is a no-op and
 * `reset()` is a scoped drop rather than an unlink — the two places where this
 * binding's lifecycle differs from a file-backed one.
 */
export function createDoSqlDriver(storage: DurableObjectStorage): SqlDriver {
  const sql = storage.sql;

  // Direct, not through `exec` below: the bookkeeping tables must never record
  // THEMSELVES as store-owned, or a reset would drop the record it needs.
  sql.exec(`CREATE TABLE IF NOT EXISTS ${OBJECTS_TABLE} (name TEXT PRIMARY KEY)`);
  sql.exec(
    `CREATE TABLE IF NOT EXISTS ${DRIVER_META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  );

  /** Record every table `statements` creates, so `reset()` can drop them.
   * Persisted rather than remembered: the object hibernates, and the driver
   * that has to drop the tables is rarely the one that made them. */
  const recordCreatedTables = (statements: string): void => {
    for (const match of statements.matchAll(CREATE_TABLE_RE)) {
      const name = match[1];
      if (name === undefined) continue;
      sql.exec(`INSERT OR IGNORE INTO ${OBJECTS_TABLE} (name) VALUES (?)`, name);
    }
  };

  return {
    exec: (statements) => {
      // The cursor is consumed to force the statement to run — `exec` carries
      // DDL and pragmas, whose rows are never read.
      sql.exec(statements).toArray();
      recordCreatedTables(statements);
    },

    run: (statement, params) => {
      sql.exec(statement, ...params).toArray();
    },

    all: (query, params): SqlRow[] => sql.exec(query, ...params).toArray(),

    transaction: (fn) => {
      storage.transactionSync(fn);
    },

    schemaVersion: {
      read: () => {
        const row = sql
          .exec<{ value: string }>(
            `SELECT value FROM ${DRIVER_META_TABLE} WHERE key = ?`,
            SCHEMA_VERSION_KEY,
          )
          .toArray()[0];
        const parsed = row === undefined ? Number.NaN : Number(row.value);
        // A row that is not a number is a corrupt cache, and 0 is the answer
        // that makes the store rebuild — the same verdict every other guard
        // reaches, reached without a throw the caller would have to catch.
        return Number.isFinite(parsed) ? parsed : 0;
      },
      write: (version) => {
        sql.exec(
          `INSERT INTO ${DRIVER_META_TABLE} (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          SCHEMA_VERSION_KEY,
          String(version),
        );
      },
    },

    reset: () => {
      storage.transactionSync(() => {
        const owned = sql
          .exec<{ name: string }>(`SELECT name FROM ${OBJECTS_TABLE}`)
          .toArray()
          .map((row) => row.name);
        // A table name cannot be bound, and does not need to be: every one of
        // these was captured by CREATE_TABLE_RE's `\w+`, so it is an identifier
        // and nothing else.
        for (const name of owned) sql.exec(`DROP TABLE IF EXISTS "${name}"`);
        sql.exec(`DELETE FROM ${OBJECTS_TABLE}`);
        sql.exec(`DELETE FROM ${DRIVER_META_TABLE}`);
      });
    },

    // The database outlives every driver bound to it — closing it is the
    // object's business, and there is no handle here to release.
    close: () => {},
  };
}
