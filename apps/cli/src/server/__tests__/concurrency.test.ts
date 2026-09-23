import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../concurrency";

describe("mapWithConcurrency", () => {
  it("answers in input order whatever order the units finish in", async () => {
    const results = await mapWithConcurrency([30, 0, 10], 3, async (wait, index) => {
      await delay(wait);
      return index * 2;
    });
    expect(results).toEqual([0, 2, 4]);
  });

  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await delay(0);
      running -= 1;
    });
    expect(peak).toBe(3);
  });

  it("maps undefined items rather than reading them as the end", async () => {
    const results = await mapWithConcurrency([1, undefined, 3], 1, async (item) => item ?? 0);
    expect(results).toEqual([1, 0, 3]);
  });

  it("starts nothing after a rejection, and rejects only once the started units settle", async () => {
    const started: number[] = [];
    const slow: PromiseWithResolvers<void> = Promise.withResolvers();
    let slowSettled = false;
    let runSettled = false;
    const run = (async () => {
      try {
        return await mapWithConcurrency([0, 1, 2, 3, 4], 2, async (item) => {
          started.push(item);
          if (item === 0) {
            await slow.promise;
            slowSettled = true;
            return item;
          }
          throw new Error(`unit ${item} failed`);
        });
      } finally {
        runSettled = true;
      }
    })();

    await delay(0);
    expect(started).toEqual([0, 1]);
    expect(runSettled).toBe(false);

    slow.resolve();
    await expect(run).rejects.toThrow("unit 1 failed");
    expect(slowSettled).toBe(true);
    expect(started).toEqual([0, 1]);
  });
});
