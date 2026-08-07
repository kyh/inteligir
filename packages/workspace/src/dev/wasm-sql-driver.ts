// ---------------------------------------------------------------------------
// SQLite-wasm binding for the shared SQL knowledge store — the browser's
// twin of the Durable Object's driver (host/knowledge/do-sql-driver.ts).
// The schema, guards, and every query live in @repo/notes
// (sql-knowledge-store.ts, driver-injected); this module only supplies the
// browser byte-level driver, so a fixture-backed search runs the IDENTICAL
// FTS5 bm25 ranking the product ships.
//
// The binding is @sqlite.org/sqlite-wasm — the official SQLite build (stock
// sql.js does not compile FTS5, which would defeat the whole point). Its oo1
// API is fully synchronous once the wasm module has loaded, so the async
// load happens ONCE (loadSqlite3) and the driver itself honors the
// synchronous SqlDriver contract. The DB is in-memory: the fixture
// vault is an in-memory Map that reseeds on reload, so a persistent index
// would only ever serve stale rows. Fixture-only — never part of the
// product build (only dev/ imports it).
// ---------------------------------------------------------------------------

import sqlite3InitModule, { type Sqlite3Static } from "@sqlite.org/sqlite-wasm";

import type { SqlDriver } from "@repo/notes/knowledge/sql-knowledge-store";

let modulePromise: Promise<Sqlite3Static> | null = null;

/** Load the sqlite wasm module (once — subsequent calls share the promise).
 * The ONLY async step; every driver created from the result is synchronous. */
export function loadSqlite3(): Promise<Sqlite3Static> {
  modulePromise ??= sqlite3InitModule();
  return modulePromise;
}

/** An in-memory SqlDriver over a loaded sqlite wasm module. oo1's exec
 * prepares, binds, steps, and finalizes internally — all synchronous. */
export function createWasmSqlDriver(sqlite3: Sqlite3Static): SqlDriver {
  let db = new sqlite3.oo1.DB();
  return {
    exec: (sql) => {
      db.exec(sql);
    },
    // oo1 only binds when the statement has parameters, so an empty params
    // array is safe to pass unconditionally.
    run: (sql, params) => {
      db.exec({ sql, bind: params });
    },
    all: (sql, params) =>
      db.exec({ sql, bind: params, rowMode: "object", returnValue: "resultRows" }),
    reset: () => {
      // In-memory: closing the handle drops the instance — no files to unlink.
      db.close();
      db = new sqlite3.oo1.DB();
    },
    close: () => {
      db.close(); // no-op when already closed (oo1 contract)
    },
  };
}
