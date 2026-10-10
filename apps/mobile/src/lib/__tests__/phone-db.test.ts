import { describe, expect, it } from "vitest";
import { z } from "zod";
import { openTempDb } from "../../notes/__tests__/phone-storage";
import { phoneDbReady } from "../phone-db";

const tableNameSchema = z.object({ name: z.string() });

describe("the phone's database", () => {
  it("builds every table on a fresh install in one step", async () => {
    const db = openTempDb();
    await phoneDbReady(db);

    expect(await db.all("PRAGMA user_version")).toEqual([{ user_version: 1 }]);
    const tables = await db.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(tables.map((row) => tableNameSchema.parse(row).name)).toEqual([
      "dispatch_outbox",
      "mirror_entries",
      "mirror_landings",
      "mirror_meta",
      "outbox",
      "synced_threads",
      "thread_events",
      "thread_sync",
    ]);
  });

  it("refuses a file a newer build saved", async () => {
    const db = openTempDb();
    await db.exclusive(async (tx) => {
      await tx.exec("PRAGMA user_version = 2");
    });

    await expect(phoneDbReady(db)).rejects.toThrow("newer version");
  });
});
