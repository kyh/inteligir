import { afterEach, describe, it, expect, vi } from "vitest";
import { Type } from "@sinclair/typebox";

import { createDoStoreAdapter, type SyncKv } from "../store/do-store-adapter";
import { JsonStoreCore } from "../store/json-store-core";

/** Stand-in for a SQLite-backed Durable Object's `ctx.storage.kv`: the same
 * three synchronous operations over an in-memory map. */
function memoryKv(): SyncKv & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    get: (key) => entries.get(key),
    put: (key, value) => {
      entries.set(key, value);
    },
    delete: (key) => {
      entries.delete(key);
    },
  };
}

const NumbersSchema = Type.Array(Type.Number());

const VersionedSchema = Type.Object(
  { version: Type.Literal(2), items: Type.Array(Type.Number()) },
  { additionalProperties: false },
);

type Versioned = { version: 2; items: number[] };

const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
afterEach(() => {
  consoleError.mockClear();
});

describe("createDoStoreAdapter", () => {
  it("round-trips a store through the KV, keyed by the store's key", () => {
    const kv = memoryKv();
    const adapter = createDoStoreAdapter(kv);

    const store = new JsonStoreCore<number[]>(adapter, "ui-state.json", NumbersSchema, []);
    expect(store.read()).toEqual([]);
    store.write([1, 2, 3]);

    expect(JSON.parse(kv.entries.get("ui-state.json") ?? "")).toEqual([1, 2, 3]);
    // A second store over the same KV reads what the first wrote — no cache.
    const reopened = new JsonStoreCore<number[]>(adapter, "ui-state.json", NumbersSchema, []);
    expect(reopened.read()).toEqual([1, 2, 3]);
  });

  it("reads a missing key as the default value", () => {
    const kv = memoryKv();
    const store = new JsonStoreCore<number[]>(
      createDoStoreAdapter(kv),
      "absent.json",
      NumbersSchema,
      [7],
    );

    expect(store.read()).toEqual([7]);
    expect(kv.entries.size).toBe(0);
  });

  it("quarantines a corrupt entry to a sibling key without losing the bytes", () => {
    const kv = memoryKv();
    kv.entries.set("store.json", "{broken");
    const store = new JsonStoreCore<number[]>(
      createDoStoreAdapter(kv),
      "store.json",
      NumbersSchema,
      [],
      {},
    );

    expect(store.read()).toEqual([]);

    expect(kv.entries.has("store.json")).toBe(false);
    const backupKey = [...kv.entries.keys()].find((k) => k.startsWith("store.json.corrupt-"));
    if (!backupKey) throw new Error("expected a corrupt backup entry");
    expect(kv.entries.get(backupKey)).toBe("{broken");
  });

  it("quarantines a newer-version entry under a version-stamped key", () => {
    const kv = memoryKv();
    const newer = JSON.stringify({ version: 3, items: [9] });
    kv.entries.set("store.json", newer);
    const store = new JsonStoreCore<Versioned>(
      createDoStoreAdapter(kv),
      "store.json",
      VersionedSchema,
      { version: 2, items: [] },
      { versioning: { current: 2 } },
    );

    expect(store.read()).toEqual({ version: 2, items: [] });

    expect(kv.entries.has("store.json")).toBe(false);
    const backupKey = [...kv.entries.keys()].find((k) => k.startsWith("store.json.newer-v3-"));
    if (!backupKey) throw new Error("expected a newer-version quarantine entry");
    expect(kv.entries.get(backupKey)).toBe(newer);
  });

  it("stops writing to the KV once the store is closed", () => {
    const kv = memoryKv();
    const store = new JsonStoreCore<number[]>(
      createDoStoreAdapter(kv),
      "store.json",
      NumbersSchema,
      [],
    );

    store.write([1]);
    store.close();
    store.write([2]);
    store.update((current) => [...current, 3]);

    expect(JSON.parse(kv.entries.get("store.json") ?? "")).toEqual([1]);
  });

  it("refuses to rename a key that holds nothing", () => {
    const kv = memoryKv();
    const adapter = createDoStoreAdapter(kv);

    expect(() => adapter.rename("absent.json", "absent.json.corrupt-1")).toThrow(/missing key/);
    expect(kv.entries.size).toBe(0);
  });
});
