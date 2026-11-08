import { describe, expect, it } from "vitest";

import { ensureLibrarySchema, LIBRARY_SCHEMA_VERSION } from "./library-schema";
import { runPlan } from "./library-sql";
import type { SqlPort } from "./library-sql";
import { openWasmSqlPort, transactPlan } from "../test-support/wasm-sql-port";

const tables = (port: SqlPort): string[] =>
  port
    .all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name", [])
    .map((row) => String(row.name));

describe(ensureLibrarySchema, () => {
  it("creates the cell's tables on an empty database", () => {
    const cell = openWasmSqlPort();
    expect(transactPlan(cell, ensureLibrarySchema())).toStrictEqual({ kind: "created" });
    expect(tables(cell)).toStrictEqual(
      expect.arrayContaining(["items", "blocks", "change_sets", "snapshot_parts", "jobs"]),
    );
  });

  it("finds its own schema current, and runs no PRAGMA to know it", () => {
    const port = openWasmSqlPort();
    transactPlan(port, ensureLibrarySchema());
    port.statements.length = 0;
    expect(transactPlan(port, ensureLibrarySchema())).toStrictEqual({ kind: "current" });
    expect(port.statements.map((statement) => statement.sql).join("\n")).not.toMatch(/PRAGMA/iu);
    expect(port.all("SELECT v FROM meta WHERE k = 'schema'", [])).toStrictEqual([
      { v: LIBRARY_SCHEMA_VERSION },
    ]);
  });

  it("answers another version, or a database it did not make, as a mismatch to start over", () => {
    const older = openWasmSqlPort();
    transactPlan(older, ensureLibrarySchema());
    older.run("UPDATE meta SET v = ? WHERE k = 'schema'", [LIBRARY_SCHEMA_VERSION - 1]);
    expect(runPlan(older, ensureLibrarySchema())).toStrictEqual({
      found: String(LIBRARY_SCHEMA_VERSION - 1),
      kind: "mismatch",
    });
    const foreign = openWasmSqlPort();
    foreign.run("CREATE TABLE items (path TEXT)", []);
    expect(runPlan(foreign, ensureLibrarySchema())).toStrictEqual({
      found: "none",
      kind: "mismatch",
    });
    const odd = openWasmSqlPort();
    odd.run("CREATE TABLE meta (key TEXT, value TEXT)", []);
    expect(runPlan(odd, ensureLibrarySchema())).toStrictEqual({
      found: "unreadable",
      kind: "mismatch",
    });
  });

  it("asks the engine nothing, since a Durable Object refuses sqlite_version()", () => {
    const port = openWasmSqlPort();
    expect(transactPlan(port, ensureLibrarySchema())).toStrictEqual({ kind: "created" });
    expect(port.statements.map((statement) => statement.sql).join("\n")).not.toMatch(
      /sqlite_version/iu,
    );
  });
});
