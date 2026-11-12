import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { meta } from "@repo/db/cell/schema";
import { cellOf, inCell } from "./test-support/library-cell";
import { CELL_SCHEMA, cellDbOf } from "./library/cell-db";
import { applyObjectSchema, SCHEMA_HASH_KEY } from "./object-schema";

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

// a fresh cell, its schema applied by its own constructor, handed to `work` to rearrange
const inOpenedCell = async (
  work: (storage: DurableObjectStorage) => void | Promise<void>,
): Promise<void> => {
  await inCell(cellOf(), async (state) => {
    await work(state.storage);
  });
};

// the cell started over: the log names what it found, and the probe went with it
const expectStartsOver = async (
  storage: DurableObjectStorage,
  found: { readonly hash: unknown; readonly tables: unknown },
): Promise<void> => {
  const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
  await applyObjectSchema(storage, CELL_SCHEMA);
  expect(warned).toHaveBeenCalledWith({ event: "cell-schema-reset", found });
  warned.mockRestore();
  expect(holdsProbe(storage)).toBe(false);
  expect(tables(storage)).toStrictEqual(expect.arrayContaining(["items", "search_fts"]));
};

describe(applyObjectSchema, () => {
  it("makes an empty cell's tables, the search index's included", async () => {
    await inOpenedCell(async (storage) => {
      await storage.deleteAll();
      const warned = vi.spyOn(console, "warn");
      await applyObjectSchema(storage, CELL_SCHEMA);
      expect(warned).not.toHaveBeenCalled();
      warned.mockRestore();
      expect(tables(storage)).toStrictEqual(expect.arrayContaining(["items", "search_fts"]));
    });
  });

  it("leaves a cell this DDL made as it is", async () => {
    await inOpenedCell(async (storage) => {
      holdProbe(storage);
      await applyObjectSchema(storage, CELL_SCHEMA);
      expect(holdsProbe(storage)).toBe(true);
    });
  });

  it("starts over empty when another DDL made the cell", async () => {
    await inOpenedCell(async (storage) => {
      holdProbe(storage);
      storage.kv.put(SCHEMA_HASH_KEY, "another");
      await expectStartsOver(storage, {
        hash: "another",
        tables: expect.arrayContaining(["items", "meta"]),
      });
    });
  });

  it("starts over empty when the cell holds tables and no DDL's hash", async () => {
    await inOpenedCell(async (storage) => {
      holdProbe(storage);
      storage.kv.delete(SCHEMA_HASH_KEY);
      await expectStartsOver(storage, {
        hash: null,
        tables: expect.arrayContaining(["items", "meta"]),
      });
    });
  });

  it("lands nothing of a DDL that fails part way", async () => {
    await inOpenedCell(async (storage) => {
      await storage.deleteAll();
      const failing = { ddl: "CREATE TABLE twice (v); CREATE TABLE twice (v);", what: "cell" };
      await expect(applyObjectSchema(storage, failing)).rejects.toThrow(/already exists/u);
      expect(tables(storage)).not.toContain("twice");
      expect(storage.kv.get(SCHEMA_HASH_KEY)).toBeUndefined();
    });
  });
});
