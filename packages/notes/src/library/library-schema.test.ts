import { describe, expect, it } from "vitest";

import {
  ensureLibrarySchema,
  LIBRARY_SCHEMA_VERSION,
  libraryDdl,
  sqliteVersionAtLeast,
} from "./library-schema";
import { runPlan } from "./library-sql";
import type { SqlPort } from "./library-sql";
import { openWasmSqlPort, transactPlan } from "../test-support/wasm-sql-port";

const tables = (port: SqlPort): string[] =>
  port
    .all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name", [])
    .map((row) => String(row.name));

describe(ensureLibrarySchema, () => {
  it("creates the synced tables on a replica and the cell's beside them on a cell", () => {
    const replica = openWasmSqlPort();
    expect(transactPlan(replica, ensureLibrarySchema("replica"))).toStrictEqual({
      kind: "created",
    });
    const cell = openWasmSqlPort();
    expect(transactPlan(cell, ensureLibrarySchema("cell"))).toStrictEqual({ kind: "created" });
    expect(tables(replica)).toStrictEqual(
      expect.arrayContaining(["items", "outbox", "body_wants"]),
    );
    expect(tables(replica)).not.toContain("change_sets");
    expect(tables(cell)).toStrictEqual(
      expect.arrayContaining(["change_sets", "revisions", "jobs"]),
    );
    expect(tables(cell)).not.toContain("outbox");
    expect(libraryDdl("cell").length).toBeGreaterThan(libraryDdl("replica").length);
  });

  it("finds its own schema current, and runs no PRAGMA to know it", () => {
    const port = openWasmSqlPort();
    transactPlan(port, ensureLibrarySchema("cell"));
    port.statements.length = 0;
    expect(transactPlan(port, ensureLibrarySchema("cell"))).toStrictEqual({ kind: "current" });
    expect(port.statements.map((statement) => statement.sql).join("\n")).not.toMatch(/PRAGMA/iu);
    expect(port.all("SELECT v FROM meta WHERE k = 'schema'", [])).toStrictEqual([
      { v: LIBRARY_SCHEMA_VERSION },
    ]);
  });

  it("answers another version, or a database it did not make, as a mismatch to start over", () => {
    const older = openWasmSqlPort();
    transactPlan(older, ensureLibrarySchema("replica"));
    older.run("UPDATE meta SET v = ? WHERE k = 'schema'", [LIBRARY_SCHEMA_VERSION - 1]);
    expect(runPlan(older, ensureLibrarySchema("replica"))).toStrictEqual({
      found: String(LIBRARY_SCHEMA_VERSION - 1),
      kind: "mismatch",
    });
    const foreign = openWasmSqlPort();
    foreign.run("CREATE TABLE items (path TEXT)", []);
    expect(runPlan(foreign, ensureLibrarySchema("replica"))).toStrictEqual({
      found: "none",
      kind: "mismatch",
    });
    const odd = openWasmSqlPort();
    odd.run("CREATE TABLE meta (key TEXT, value TEXT)", []);
    expect(runPlan(odd, ensureLibrarySchema("replica"))).toStrictEqual({
      found: "unreadable",
      kind: "mismatch",
    });
  });

  it("refuses a replica's engine older than the schema needs", () => {
    const port = openWasmSqlPort();
    const old: SqlPort = {
      ...port,
      all: (sql, params) =>
        sql.includes("sqlite_version") ? [{ version: "3.31.1" }] : port.all(sql, params),
    };
    expect(runPlan(old, ensureLibrarySchema("replica"))).toStrictEqual({
      kind: "unsupported",
      sqliteVersion: "3.31.1",
    });
  });

  it("asks the cell's engine nothing, since a Durable Object refuses sqlite_version()", () => {
    const port = openWasmSqlPort();
    expect(transactPlan(port, ensureLibrarySchema("cell"))).toStrictEqual({ kind: "created" });
    expect(port.statements.map((statement) => statement.sql).join("\n")).not.toMatch(
      /sqlite_version/iu,
    );
  });
});

describe(sqliteVersionAtLeast, () => {
  it.each([
    ["3.37.0", "3.37.0", true],
    ["3.45.1", "3.37.0", true],
    ["3.36.9", "3.37.0", false],
    ["4.0", "3.37.0", true],
  ])("%s against %s is %s", (version, floor, expected) => {
    expect(sqliteVersionAtLeast(version, floor)).toBe(expected);
  });
});
