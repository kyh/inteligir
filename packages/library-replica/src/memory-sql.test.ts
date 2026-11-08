import { describe, expect, it } from "vitest";

import { openMemorySql } from "./memory-sql";
import { deferred } from "@repo/contract/test-support/deferred";

describe("the replica's database in memory", () => {
  it("commits a transaction that resolves and rolls back one that throws", async () => {
    const sql = await openMemorySql();
    await sql.run("CREATE TABLE notes (id TEXT PRIMARY KEY) STRICT", []);
    await sql.exclusive(async (tx) => {
      await tx.run("INSERT INTO notes (id) VALUES (?)", ["kept"]);
    });
    await expect(
      sql.exclusive(async (tx) => {
        await tx.run("INSERT INTO notes (id) VALUES (?)", ["lost"]);
        throw new Error("the work failed");
      }),
    ).rejects.toThrow("the work failed");
    await expect(sql.all("SELECT id FROM notes ORDER BY id", [])).resolves.toStrictEqual([
      { id: "kept" },
    ]);
    sql.close();
  });

  it("holds a statement outside a transaction until the transaction ends", async () => {
    const sql = await openMemorySql();
    await sql.run("CREATE TABLE notes (id TEXT PRIMARY KEY) STRICT", []);
    const gate = deferred();
    const running = sql.exclusive(async (tx) => {
      await tx.run("INSERT INTO notes (id) VALUES (?)", ["half"]);
      await gate.promise;
      await tx.run("INSERT INTO notes (id) VALUES (?)", ["whole"]);
    });
    const read = sql.all("SELECT count(*) AS n FROM notes", []);
    gate.resolve();
    await running;
    await expect(read).resolves.toStrictEqual([{ n: 2 }]);
    sql.close();
  });

  it("has full-text search", async () => {
    const sql = await openMemorySql();
    await sql.run("CREATE VIRTUAL TABLE search USING fts5(body)", []);
    await sql.run("INSERT INTO search (body) VALUES (?)", ["a library of everything you save"]);
    await expect(
      sql.all("SELECT body FROM search WHERE search MATCH ?", ["library"]),
    ).resolves.toHaveLength(1);
    sql.close();
  });
});
