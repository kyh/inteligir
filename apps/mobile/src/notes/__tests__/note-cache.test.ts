import { describe, expect, it } from "vitest";
import { createMemoryNoteCache } from "../note-cache";

const C1 = "1".repeat(40);
const C2 = "2".repeat(40);

describe("the memory note cache", () => {
  it("round-trips a row by (commit, path) and misses everything else", async () => {
    const cache = createMemoryNoteCache(10);
    await cache.set({ commit: C1, content: "# a\n", path: "a.md" });
    expect(await cache.get(C1, "a.md")).toEqual({ commit: C1, content: "# a\n", path: "a.md" });
    expect(await cache.get(C2, "a.md")).toBeNull();
    expect(await cache.get(C1, "b.md")).toBeNull();
  });

  it("evicts the oldest row past the bound", async () => {
    const cache = createMemoryNoteCache(2);
    await cache.set({ commit: C1, content: "a", path: "a.md" });
    await cache.set({ commit: C1, content: "b", path: "b.md" });
    await cache.set({ commit: C1, content: "c", path: "c.md" });
    expect(await cache.get(C1, "a.md")).toBeNull();
    expect(await cache.get(C1, "b.md")).not.toBeNull();
    expect(await cache.get(C1, "c.md")).not.toBeNull();
  });

  it("sweep keeps only the commit still reachable from the tree", async () => {
    const cache = createMemoryNoteCache(10);
    await cache.set({ commit: C1, content: "old", path: "a.md" });
    await cache.set({ commit: C2, content: "new", path: "a.md" });
    await cache.sweep(C2);
    expect(await cache.get(C1, "a.md")).toBeNull();
    expect(await cache.get(C2, "a.md")).toEqual({ commit: C2, content: "new", path: "a.md" });
  });

  it("clear forgets everything", async () => {
    const cache = createMemoryNoteCache(10);
    await cache.set({ commit: C1, content: "a", path: "a.md" });
    await cache.clear();
    expect(await cache.get(C1, "a.md")).toBeNull();
  });
});
