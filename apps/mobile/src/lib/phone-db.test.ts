import { ensureLibrarySchema } from "@repo/notes/library/library-schema";
import { runPlanAsync } from "@repo/notes/library/library-sql";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { openNodeReplicaSql } from "./node-replica-sql";
import { openPhoneTables } from "./phone-db";

const namesSchema = z.array(z.object({ name: z.string() }));

// the database as the replica engine opens it, before the phone's own tables
const replicaSql = async () => {
  const sql = openNodeReplicaSql(":memory:");
  await sql.exclusive(async (tx) => await runPlanAsync(tx, ensureLibrarySchema("replica")));
  return sql;
};

describe("the phone's database", () => {
  it("lays the phone's own tables beside the replica's, versioned in its meta", async () => {
    const sql = await replicaSql();
    await openPhoneTables(sql);
    // opening again finds them current and changes nothing
    await openPhoneTables(sql);

    const tables = namesSchema.parse(
      await sql.all(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'phone_%'",
        [],
      ),
    );
    expect(tables.map((row) => row.name)).toEqual(["phone_files"]);
    expect(await sql.all("SELECT v FROM meta WHERE k = 'phone_schema'", [])).toEqual([{ v: 1 }]);
    expect(await sql.all("PRAGMA user_version", [])).toEqual([{ user_version: 0 }]);
  });

  it("refuses a file a newer build saved", async () => {
    const sql = await replicaSql();
    await sql.run("INSERT INTO meta (k, v) VALUES ('phone_schema', 2)", []);
    await expect(openPhoneTables(sql)).rejects.toThrow("newer version");
  });

  it("runs every statement bound, a transaction rolled back whole when its work throws", async () => {
    const sql = await replicaSql();
    await openPhoneTables(sql);
    const quote = 'it\'s "quoted"; DROP TABLE meta; --';
    await expect(
      sql.exclusive(async (tx) => {
        await tx.run("INSERT INTO meta (k, v) VALUES (?, ?)", ["kept?", quote]);
        throw new Error("the work failed");
      }),
    ).rejects.toThrow("the work failed");
    expect(await sql.all("SELECT v FROM meta WHERE k = ?", ["kept?"])).toEqual([]);

    await sql.run("INSERT INTO meta (k, v) VALUES (?, ?)", ["kept", quote]);
    expect(await sql.all("SELECT v FROM meta WHERE k = ?", ["kept"])).toEqual([{ v: quote }]);
  });
});
