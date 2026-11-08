import { MOVED_IDS_MAX } from "@repo/contract/cloud/library/library-socket";
import { describe, expect, it } from "vitest";

import { collectMoved } from "./cell-moved";

const idsOf = (count: number): string[] =>
  Array.from(
    { length: count },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );

describe("what a write moved", () => {
  it("is no frame when the write moved nothing a client reads", () => {
    expect(collectMoved().frame()).toBeNull();
  });

  it("names each item at its sequence, the folders and each thread, once", () => {
    const moved = collectMoved();
    const [item = "", thread = ""] = idsOf(2);
    moved.item(item, 7);
    moved.item(item, 7);
    moved.thread(thread);
    moved.thread(thread);
    moved.folder();
    expect(moved.frame()).toStrictEqual({
      folders: true,
      items: [{ id: item, seq: 7 }],
      threads: [thread],
      type: "moved",
    });
  });

  it("says all past the most ids a frame names, list by list", () => {
    const moved = collectMoved();
    for (const id of idsOf(MOVED_IDS_MAX + 1)) {
      moved.item(id, 3);
    }
    for (const id of idsOf(MOVED_IDS_MAX)) {
      moved.thread(id);
    }
    const frame = moved.frame();
    expect(frame?.items).toBe("all");
    expect(frame?.threads).toHaveLength(MOVED_IDS_MAX);
  });
});
