import { describe, expect, it } from "vitest";
import type { PendingFill } from "../notes/notes-store";
import { createFillQueue } from "./fill-queue";
import type { LinkFillOutcome } from "./link-fill";

const MINUTE = 60_000;

const row = (itemId: string, notBefore: number, attempts = 0): PendingFill => ({
  attempts,
  itemId,
  notBefore,
  path: `Unsorted/${itemId}.md`,
  url: `https://example.com/${itemId}`,
});

// the store's rows in memory, and one timer the test fires by hand
const queueOver = (
  rows: PendingFill[],
  answer: (row: PendingFill, mayRetry: boolean) => Promise<LinkFillOutcome>,
) => {
  let now = 0;
  let can = true;
  const filled: { itemId: string; mayRetry: boolean }[] = [];
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  const held = new Map(rows.map((each) => [each.itemId, each]));
  const queue = createFillQueue({
    canFill: () => can,
    fill: async (each, mayRetry) => {
      filled.push({ itemId: each.itemId, mayRetry });
      return await answer(each, mayRetry);
    },
    now: () => now,
    setTimer: (ms, run) => {
      const timer = { at: now + ms, cancelled: false, run };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    store: {
      pendingFills: {
        list: async () =>
          await Promise.resolve([...held.values()].toSorted((a, b) => a.notBefore - b.notBefore)),
        remove: async (itemId) => {
          held.delete(itemId);
          await Promise.resolve();
        },
        update: async (next) => {
          held.set(next.itemId, next);
          await Promise.resolve();
        },
      },
    },
  });
  const armed = () => timers.filter((timer) => !timer.cancelled);
  return {
    armed,
    filled,
    held,
    queue,
    setCan: (value: boolean) => {
      can = value;
    },
    // the clock moves to the armed timer and it fires
    async tick() {
      const [next] = armed();
      if (next === undefined) {
        throw new Error("no timer is armed");
      }
      next.cancelled = true;
      now = next.at;
      next.run();
      await queue.settled();
    },
  };
};

const written = async (): Promise<LinkFillOutcome> => await Promise.resolve({ kind: "written" });
const retry = async (): Promise<LinkFillOutcome> => await Promise.resolve({ kind: "retry" });

describe("the phone's fill queue", () => {
  it("reads every due link, oldest first, and forgets each one it read", async () => {
    const run = queueOver([row("b", 0), row("a", -5)], written);
    run.queue.wake();
    await run.queue.settled();

    expect(run.filled.map((each) => each.itemId)).toStrictEqual(["a", "b"]);
    expect([...run.held.keys()]).toStrictEqual([]);
    expect(run.armed()).toStrictEqual([]);
  });

  it("tries a failure a later try may pass after 1, 10 and 60 minutes, and the fourth says it in the file", async () => {
    const run = queueOver([row("a", 0)], async (_, mayRetry) =>
      mayRetry ? await retry() : await written(),
    );
    await run.queue.settled();
    expect(run.held.get("a")).toMatchObject({ attempts: 1, notBefore: MINUTE });

    await run.tick();
    expect(run.held.get("a")).toMatchObject({ attempts: 2, notBefore: 11 * MINUTE });
    await run.tick();
    expect(run.held.get("a")).toMatchObject({ attempts: 3, notBefore: 71 * MINUTE });
    await run.tick();

    expect(run.filled.map((each) => each.mayRetry)).toStrictEqual([true, true, true, false]);
    expect(run.held.size).toBe(0);
  });

  it("waits for a row not yet due, and reads nothing while it may not", async () => {
    const run = queueOver([row("a", 5 * MINUTE)], written);
    await run.queue.settled();
    expect(run.filled).toStrictEqual([]);
    expect(run.armed().map((timer) => timer.at)).toStrictEqual([5 * MINUTE]);

    run.setCan(false);
    await run.tick();
    expect(run.filled).toStrictEqual([]);

    run.setCan(true);
    run.queue.wake();
    await run.queue.settled();
    expect(run.filled.map((each) => each.itemId)).toStrictEqual(["a"]);
  });

  it("arms no timer while the app is away, and reads again once it wakes", async () => {
    const run = queueOver([row("a", 5 * MINUTE)], written);
    await run.queue.settled();
    run.queue.suspend();
    expect(run.armed()).toStrictEqual([]);

    run.queue.wake();
    await run.queue.settled();
    expect(run.armed().map((timer) => timer.at)).toStrictEqual([5 * MINUTE]);
  });

  it("tries a fill that threw on the same schedule", async () => {
    const run = queueOver([row("a", 0)], async () => await Promise.reject(new Error("gone")));
    await run.queue.settled();
    expect(run.held.get("a")).toMatchObject({ attempts: 1, notBefore: MINUTE });
  });

  it("reads a save made while it was reading in the same run", async () => {
    let added = false;
    const run = queueOver([row("a", 0)], async (each) => {
      if (each.itemId === "a" && !added) {
        added = true;
        run.held.set("b", row("b", 0));
        run.queue.wake();
      }
      return await written();
    });
    await run.queue.settled();
    expect(run.filled.map((each) => each.itemId)).toStrictEqual(["a", "b"]);
  });
});
