// The library's SQL under test: SQLite's own wasm build, in memory, behind the port the cell and the
// replicas hand the plans. The port holds every statement to a SQLite Durable Object's limits
// (https://developers.cloudflare.com/durable-objects/platform/limits/ and
// https://developers.cloudflare.com/durable-objects/api/sql-storage/), so a plan that would be
// refused on the cell fails here: past 100 bound parameters, past 100 KB of text, a value past
// 2 MB, a pattern match, a pragma, or a transaction statement sent as SQL.

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { z } from "zod";

import { utf8ByteLength } from "../library/canonical-json";
import { SQL_MAX_PARAMS, SQL_MAX_STATEMENT_BYTES } from "../library/library-sql";
import type { AsyncSqlPort, SqlPort, SqlRow, SqlStatement, SqlValue } from "../library/library-sql";

const sqlite3 = await sqlite3InitModule();

const VALUE_MAX_BYTES = 2_000_000;
const REFUSED_SQL = /\b(?:like|glob|pragma|begin|commit|rollback|savepoint|release)\b/iu;

const rowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

export interface WasmSqlPort extends SqlPort {
  // every statement the port ran, in order
  readonly statements: SqlStatement[];
  // the database's own statement, past the limits: what a replica's driver sends to hold a
  // transaction open across awaits
  readonly raw: (sql: string) => void;
  readonly close: () => void;
}

const isText = (value: SqlValue): value is string => typeof value === "string";

const checkLimits = (sql: string, params: readonly SqlValue[]): void => {
  if (params.length > SQL_MAX_PARAMS) {
    throw new Error(`${String(params.length)} bound parameters, past a Durable Object's 100`);
  }
  if (utf8ByteLength(sql) > SQL_MAX_STATEMENT_BYTES) {
    throw new Error("statement text past a Durable Object's 100 KB");
  }
  if (REFUSED_SQL.test(sql)) {
    throw new Error(`a Durable Object refuses this statement: ${sql.slice(0, 80)}`);
  }
  for (const value of params) {
    if (isText(value) && utf8ByteLength(value) > VALUE_MAX_BYTES) {
      throw new Error("a bound value past a Durable Object's 2 MB");
    }
  }
};

export const openWasmSqlPort = (): WasmSqlPort => {
  const db = new sqlite3.oo1.DB(":memory:", "c");
  const statements: SqlStatement[] = [];
  const record = (sql: string, params: readonly SqlValue[]): void => {
    checkLimits(sql, params);
    statements.push({ params, sql });
  };
  return {
    all: (sql, params): SqlRow[] => {
      record(sql, params);
      return db.selectObjects(sql, [...params]).map((row) => rowSchema.parse(row));
    },
    close: () => {
      db.close();
    },
    raw: (sql) => {
      db.exec(sql);
    },
    run: (sql, params) => {
      record(sql, params);
      db.exec({ bind: [...params], sql });
    },
    statements,
    transaction: (work) => db.transaction(() => work()),
  };
};

// the same database behind an asynchronous port, as a replica's driver presents it, holding its
// transaction open across awaits with a savepoint
export const asyncPortOf = (port: WasmSqlPort): AsyncSqlPort => {
  const statements = {
    all: async (sql: string, params: readonly SqlValue[]) =>
      await Promise.resolve(port.all(sql, params)),
    run: async (sql: string, params: readonly SqlValue[]) => {
      await Promise.resolve(port.run(sql, params));
    },
  };
  return {
    ...statements,
    transaction: async (work) => {
      port.raw("SAVEPOINT replica");
      try {
        const value = await work(statements);
        port.raw("RELEASE replica");
        return value;
      } catch (error) {
        port.raw("ROLLBACK TO replica");
        port.raw("RELEASE replica");
        throw error;
      }
    },
  };
};
