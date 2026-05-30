import { describe, it, expect } from "vitest";
import { z } from "zod";
import { JsonStore, type FsAdapter } from "@/main/lib/json-store";

function memoryFs(): FsAdapter & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: (path) => files.get(path) ?? null,
    write: (path, content) => {
      files.set(path, content);
    },
  };
}

const NumbersSchema = z.array(z.number());
const RecordsSchema = z.array(z.object({ count: z.number() }));

describe("JsonStore", () => {
  it("returns default value when file missing", () => {
    const fs = memoryFs();
    const store = new JsonStore("/test.json", NumbersSchema, [], fs);
    expect(store.read()).toEqual([]);
  });

  it("reads and validates from file", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", JSON.stringify([1, 2, 3]));
    const store = new JsonStore("/test.json", NumbersSchema, [], fs);
    expect(store.read()).toEqual([1, 2, 3]);
  });

  it("returns default on invalid data", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", JSON.stringify("not an array"));
    const store = new JsonStore("/test.json", NumbersSchema, [99], fs);
    expect(store.read()).toEqual([99]);
  });

  it("returns default on malformed JSON", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", "{broken");
    const store = new JsonStore("/test.json", NumbersSchema, [], fs);
    expect(store.read()).toEqual([]);
  });

  it("does not expose the cached default by reference", () => {
    const fs = memoryFs();
    const defaultValue = [{ count: 1 }];
    const store = new JsonStore("/test.json", RecordsSchema, defaultValue, fs);

    const first = store.read();
    const row = first[0];
    if (!row) throw new Error("missing row");
    row.count = 99;

    expect(store.read()).toEqual([{ count: 1 }]);
    expect(defaultValue).toEqual([{ count: 1 }]);
  });

  it("caches after first read", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", JSON.stringify([1]));
    const store = new JsonStore("/test.json", NumbersSchema, [], fs);

    expect(store.read()).toEqual([1]);
    // Modify file — cache should still return old value
    fs.files.set("/test.json", JSON.stringify([999]));
    expect(store.read()).toEqual([1]);
  });

  it("write updates cache and file", () => {
    const fs = memoryFs();
    const store = new JsonStore("/test.json", NumbersSchema, [], fs);

    store.write([10, 20]);
    expect(store.read()).toEqual([10, 20]);
    expect(JSON.parse(fs.files.get("/test.json") ?? "")).toEqual([10, 20]);
  });

  it("does not retain the caller's written object by reference", () => {
    const fs = memoryFs();
    const store = new JsonStore("/test.json", RecordsSchema, [], fs);
    const data = [{ count: 1 }];

    store.write(data);
    const row = data[0];
    if (!row) throw new Error("missing row");
    row.count = 99;

    expect(store.read()).toEqual([{ count: 1 }]);
  });

  it("update reads, transforms, writes atomically", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", JSON.stringify([1, 2]));
    const store = new JsonStore("/test.json", NumbersSchema, [], fs);

    const result = store.update((nums) => [...nums, 3]);
    expect(result).toEqual([1, 2, 3]);
    expect(store.read()).toEqual([1, 2, 3]);
  });

  it("invalidate clears cache", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", JSON.stringify([1]));
    const store = new JsonStore("/test.json", NumbersSchema, [], fs);

    store.read(); // populate cache
    fs.files.set("/test.json", JSON.stringify([999]));
    store.invalidate();
    expect(store.read()).toEqual([999]);
  });
});
