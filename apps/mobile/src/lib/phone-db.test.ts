import { describe, expect, it } from "vitest";
import { z } from "zod";
import { openTempDb, tempDbPath } from "../notes/test-support/phone-storage";
import { openNodeSqlDriver } from "./node-sql-driver";

const tableNameSchema = z.object({ name: z.string() });

const saveUserVersion = async (file: string, version: number): Promise<void> => {
  const raw = openNodeSqlDriver(file);
  await raw.exclusive(async (tx) => {
    await tx.exec(`PRAGMA user_version = ${String(version)}`);
  });
  raw.close();
};

describe("the phone's database", () => {
  it("builds every table on a fresh install in one step", async () => {
    const db = openTempDb();

    expect(await db.all("PRAGMA user_version")).toEqual([{ user_version: 1 }]);
    const tables = await db.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(tables.map((row) => tableNameSchema.parse(row).name)).toEqual([
      "mirror_entries",
      "mirror_landings",
      "mirror_meta",
      "outbox",
      "pending_fills",
    ]);
  });

  it("refuses a file a newer build saved", async () => {
    const file = tempDbPath();
    await saveUserVersion(file, 2);

    await expect(openTempDb(file).all("SELECT 1")).rejects.toThrow("newer version");
  });

  it("tries the migration again on the call after one failed", async () => {
    const file = tempDbPath();
    await saveUserVersion(file, 2);
    const db = openTempDb(file);
    await expect(db.all("SELECT 1")).rejects.toThrow("newer version");

    await saveUserVersion(file, 0);

    expect(await db.all("PRAGMA user_version")).toEqual([{ user_version: 1 }]);
  });
});
