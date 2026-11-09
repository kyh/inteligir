import { count, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import journal from "@repo/db/cell/migrations";
import { links, meta } from "@repo/db/cell/schema";
import { cellOf, inCell } from "../test-support/library-cell";
import { cellDbOf, insertChunks, listChunks, migrateCell } from "./cell-db";

const JOURNAL = Object.keys(journal.migrations).toSorted();
const LATER = "20990101000000_later";

const applied = (storage: DurableObjectStorage): string[] =>
  storage.sql
    .exec<{ name: string }>("SELECT name FROM __drizzle_migrations ORDER BY id")
    .toArray()
    .map((row) => row.name);

const tables = (storage: DurableObjectStorage): string[] =>
  storage.sql
    .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .toArray()
    .map((row) => row.name);

// a row the cell holds until it starts over
const holdProbe = (storage: DurableObjectStorage): void => {
  cellDbOf(storage).insert(meta).values({ k: "probe", v: 1 }).run();
};

const holdsProbe = (storage: DurableObjectStorage): boolean =>
  cellDbOf(storage).select().from(meta).where(eq(meta.k, "probe")).get() !== undefined;

// a fresh cell, which the cell's own constructor has migrated, handed to `work` to rearrange
const inMigratedCell = async (
  work: (storage: DurableObjectStorage) => void | Promise<void>,
): Promise<void> => {
  await inCell(cellOf(), async (state) => {
    await work(state.storage);
  });
};

describe(migrateCell, () => {
  it("brings an empty cell to every migration this build holds, the search index's included", async () => {
    await inMigratedCell(async (storage) => {
      await storage.deleteAll();
      await migrateCell(storage);
      expect(applied(storage)).toStrictEqual(JOURNAL);
      expect(tables(storage)).toStrictEqual(expect.arrayContaining(["items", "search_fts"]));
    });
  });

  it("leaves a cell that applied every migration as it is", async () => {
    await inMigratedCell(async (storage) => {
      holdProbe(storage);
      await migrateCell(storage);
      expect(holdsProbe(storage)).toBe(true);
      expect(applied(storage)).toStrictEqual(JOURNAL);
    });
  });

  it("runs a migration the cell skipped and keeps what it holds", async () => {
    await inMigratedCell(async (storage) => {
      const skipped = JOURNAL.at(-1) ?? "";
      holdProbe(storage);
      storage.sql.exec("DELETE FROM __drizzle_migrations WHERE name = ?", skipped);
      storage.sql.exec("DROP TABLE search_fts");
      await migrateCell(storage);
      expect(holdsProbe(storage)).toBe(true);
      expect(applied(storage)).toStrictEqual(JOURNAL);
      expect(tables(storage)).toContain("search_fts");
    });
  });

  it("starts over empty when the cell holds tables drizzle did not make", async () => {
    await inMigratedCell(async (storage) => {
      holdProbe(storage);
      storage.sql.exec("DROP TABLE __drizzle_migrations");
      storage.sql.exec("CREATE TABLE stray (v)");
      const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
      await migrateCell(storage);
      expect(warned).toHaveBeenCalledWith({
        event: "cell-schema-reset",
        found: { kind: "foreign" },
      });
      warned.mockRestore();
      expect(holdsProbe(storage)).toBe(false);
      expect(tables(storage)).not.toContain("stray");
      expect(applied(storage)).toStrictEqual(JOURNAL);
    });
  });

  it("starts over empty when the cell applied a migration this build lacks", async () => {
    await inMigratedCell(async (storage) => {
      holdProbe(storage);
      storage.sql.exec(
        "INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES ('', 0, ?)",
        LATER,
      );
      const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
      await migrateCell(storage);
      expect(warned).toHaveBeenCalledWith({
        event: "cell-schema-reset",
        found: { applied: [...JOURNAL, LATER], kind: "drizzle" },
      });
      warned.mockRestore();
      expect(holdsProbe(storage)).toBe(false);
      expect(applied(storage)).toStrictEqual(JOURNAL);
    });
  });

  it("names the migrations a failed run left, and leaves the cell as it was", async () => {
    await inMigratedCell(async (storage) => {
      const skipped = JOURNAL.at(-1) ?? "";
      holdProbe(storage);
      // the search index stands, so creating it again fails inside the migrator's transaction
      storage.sql.exec("DELETE FROM __drizzle_migrations WHERE name = ?", skipped);
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(migrateCell(storage)).rejects.toThrow(skipped);
      expect(logged).toHaveBeenCalledWith({ event: "cell-migration-failed", pending: [skipped] });
      logged.mockRestore();
      expect(holdsProbe(storage)).toBe(true);
      expect(applied(storage)).toStrictEqual(JOURNAL.slice(0, -1));
    });
  });
});

describe(insertChunks, () => {
  it("cuts a multi-row insert by the table's width into statements a Durable Object takes", async () => {
    await inMigratedCell((storage) => {
      const db = cellDbOf(storage);
      const rows = Array.from({ length: 250 }, (_, index) => ({
        sourceId: "source",
        targetId: `target-${String(index)}`,
        targetKey: null,
      }));
      // three columns a row, so 33 rows bind 99 parameters
      const chunks = insertChunks(links, rows);
      expect(chunks.map((chunk) => chunk.length)).toStrictEqual([33, 33, 33, 33, 33, 33, 33, 19]);
      expect(chunks.flat()).toStrictEqual(rows);
      expect(() => db.insert(links).values(rows).run()).toThrow(
        expect.objectContaining({
          cause: expect.objectContaining({
            message: expect.stringMatching(/too many SQL variables/u),
          }),
        }),
      );
      for (const chunk of chunks) {
        db.insert(links).values(chunk).run();
      }
      expect(db.select({ n: count() }).from(links).get()).toStrictEqual({ n: 250 });
    });
  });
});

describe(listChunks, () => {
  it("cuts an IN list so each statement binds it beside its own parameters", () => {
    const values = Array.from({ length: 250 }, (_, index) => index);
    expect(listChunks(values, 2).map((chunk) => chunk.length)).toStrictEqual([98, 98, 54]);
    expect(listChunks(values).map((chunk) => chunk.length)).toStrictEqual([100, 100, 50]);
  });
});
