import { deferred } from "@repo/contract/deferred";
import { describe, expect, it } from "vitest";

import { oneAtATime } from "./one-at-a-time";

describe(oneAtATime, () => {
  it("runs one pass at a time, and exactly one more for every ask made while one ran", async () => {
    const holds = [deferred(), deferred()];
    const began: string[] = [];

    const pass = oneAtATime(async (asker: string) => {
      began.push(asker);
      await holds[began.length - 1]?.promise;
    });

    const asks = [pass("first"), pass("second"), pass("third"), pass("fourth")];
    expect(began).toStrictEqual(["first"]);
    holds[0]?.resolve();
    await expect.poll(() => began).toStrictEqual(["first", "first"]);
    holds[1]?.resolve();
    await Promise.all(asks);
    expect(began).toHaveLength(2);
  });

  it("starts over at the next ask after a pass that failed", async () => {
    let fails = true;
    let ran = 0;

    const pass = oneAtATime(async () => {
      ran += 1;

      if (fails) {
        throw new Error("the store would not open");
      }
    });

    await expect(pass()).rejects.toThrow(/would not open/u);
    fails = false;
    await pass();
    expect(ran).toBe(2);
  });
});
