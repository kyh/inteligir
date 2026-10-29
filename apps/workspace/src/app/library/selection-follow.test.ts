import type { MovedItem } from "@repo/editor/note/vault-session";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SelectionGesture } from "./library-selection";
import { createSelectionFollow, movedItemOf } from "./selection-follow";

afterEach(() => {
  vi.useRealTimers();
});

const SCHEDULE = [100, 200];

const following = (answers: (path: string) => MovedItem[]) => {
  const applied: SelectionGesture[] = [];
  const asked: string[] = [];
  const queues = new Map<string, MovedItem[]>();
  const follow = createSelectionFollow({
    apply: (gesture) => {
      applied.push(gesture);
    },
    ask: async (path) => {
      asked.push(path);
      const queue = queues.get(path) ?? answers(path);
      queues.set(path, queue);
      return queue.shift() ?? { kind: "unknown" };
    },
    schedule: SCHEDULE,
  });
  return { applied, asked, follow };
};

describe("an index answer for an id", () => {
  it("reads a null while a read is out as no answer yet, never a gone item", () => {
    expect(movedItemOf({ path: "b.md", pending: false })).toEqual({ kind: "at", path: "b.md" });
    expect(movedItemOf({ path: null, pending: true })).toEqual({ kind: "unknown" });
    expect(movedItemOf({ path: null, pending: false })).toEqual({ kind: "gone" });
  });
});

describe("a selected item a change took away", () => {
  it("is followed to where it moved, and pruned when nothing answers its id", async () => {
    const { applied, follow } = following((path) =>
      path === "a.md" ? [{ kind: "at", path: "A page.md" }] : [{ kind: "gone" }],
    );
    follow.follow(
      ["a.md", "b.md", "c.md"],
      new Map([
        ["a.md", "id-a"],
        ["b.md", "id-b"],
      ]),
    );
    await vi.waitFor(() => {
      expect(applied).toEqual([
        { kind: "moved", moves: new Map([["a.md", "A page.md"]]) },
        { gone: new Set(["b.md", "c.md"]), kind: "prune" },
      ]);
    });
  });

  it("stays selected while the index cannot place it, and is followed once it can", async () => {
    vi.useFakeTimers();
    const { applied, asked, follow } = following(() => [
      { kind: "unknown" },
      { kind: "at", path: "A page.md" },
    ]);
    follow.follow(["a.md"], new Map([["a.md", "id-a"]]));
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toEqual([]);
    // a second change naming the same path waits on the follow already out
    follow.follow(["a.md"], new Map([["a.md", "id-a"]]));
    await vi.advanceTimersByTimeAsync(SCHEDULE[0] ?? 0);
    expect(asked).toEqual(["a.md", "a.md"]);
    expect(applied).toEqual([{ kind: "moved", moves: new Map([["a.md", "A page.md"]]) }]);
  });

  it("is pruned once the schedule ends with no answer", async () => {
    vi.useFakeTimers();
    const { applied, asked, follow } = following(() => []);
    follow.follow(["a.md"], new Map([["a.md", "id-a"]]));
    await vi.advanceTimersByTimeAsync(SCHEDULE.reduce((sum, wait) => sum + wait, 0));
    expect(asked).toHaveLength(SCHEDULE.length + 1);
    expect(applied).toEqual([{ gone: new Set(["a.md"]), kind: "prune" }]);
  });

  it("asks nothing more once disposed", async () => {
    vi.useFakeTimers();
    const { applied, asked, follow } = following(() => []);
    follow.follow(["a.md"], new Map([["a.md", "id-a"]]));
    await vi.advanceTimersByTimeAsync(0);
    follow.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(asked).toEqual(["a.md"]);
    expect(applied).toEqual([]);
  });
});
