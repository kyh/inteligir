import { describe, expect, it } from "vitest";
import { createMemoryNoteCache } from "../note-cache";

const C1 = "1".repeat(40);
const C2 = "2".repeat(40);

describe("the memory note cache", () => {
  it("round-trips a row by (commit, path) and misses everything else", async () => {
    const cache = createMemoryNoteCache(10);
    await cache.set({ commit: C1, path: "a.md", content: "# a\n" });
    expect(await cache.get(C1, "a.md")).toEqual({ commit: C1, path: "a.md", content: "# a\n" });
    expect(await cache.get(C2, "a.md")).toBeNull();
    expect(await cache.get(C1, "b.md")).toBeNull();
  });

  it("evicts the oldest row past the bound", async () => {
    const cache = createMemoryNoteCache(2);
    await cache.set({ commit: C1, path: "a.md", content: "a" });
    await cache.set({ commit: C1, path: "b.md", content: "b" });
    await cache.set({ commit: C1, path: "c.md", content: "c" });
    expect(await cache.get(C1, "a.md")).toBeNull();
    expect(await cache.get(C1, "b.md")).not.toBeNull();
    expect(await cache.get(C1, "c.md")).not.toBeNull();
  });

  it("sweep keeps only the commit still reachable from the tree", async () => {
    const cache = createMemoryNoteCache(10);
    await cache.set({ commit: C1, path: "a.md", content: "old" });
    await cache.set({ commit: C2, path: "a.md", content: "new" });
    await cache.sweep(C2);
    expect(await cache.get(C1, "a.md")).toBeNull();
    expect(await cache.get(C2, "a.md")).toEqual({ commit: C2, path: "a.md", content: "new" });
  });

  it("clear forgets everything", async () => {
    const cache = createMemoryNoteCache(10);
    await cache.set({ commit: C1, path: "a.md", content: "a" });
    await cache.clear();
    expect(await cache.get(C1, "a.md")).toBeNull();
  });
});
