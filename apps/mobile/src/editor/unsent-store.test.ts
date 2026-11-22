import { memoryKv } from "@repo/client/test-support/memory-kv.test-utils";
import { describe, expect, it } from "vitest";

import { createUnsentStore } from "./unsent-store";

const typed = { baseBlocks: [], baseVersion: 2, blocks: [], title: "Plans" };

describe(createUnsentStore, () => {
  it("keeps a note's unsent typing by its item, and forgets every one at once", async () => {
    const storage = memoryKv();
    await storage.setItem("share:one", "{}");
    const store = createUnsentStore(storage);

    await store.write("a", typed);
    await store.write("b", typed);
    await expect(store.read("a")).resolves.toStrictEqual(typed);
    await store.write("a", null);
    await expect(store.read("a")).resolves.toBeNull();

    await store.clear();
    await expect(store.read("b")).resolves.toBeNull();
    await expect(storage.getItem("share:one")).resolves.toBe("{}");
  });

  it("reads nothing from a kept value it cannot parse", async () => {
    const storage = memoryKv();
    await storage.setItem("unsent:a", "not json");

    await expect(createUnsentStore(storage).read("a")).resolves.toBeNull();
  });
});
