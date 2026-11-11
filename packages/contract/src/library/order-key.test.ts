import { describe, expect, it } from "vitest";

import { isOrdKey, ordBetween } from "./order-key";
import { mulberry32 } from "../test-support/seeded-random";

describe(isOrdKey, () => {
  it("accepts every key the library mints, splitting gaps at random (seeded)", () => {
    const rand = mulberry32(0x0e_d0);
    const keys = [ordBetween(null, null)];
    for (let step = 0; step < 2000; step += 1) {
      const at = Math.floor(rand() * (keys.length + 1));
      const key = ordBetween(keys[at - 1] ?? null, keys[at] ?? null);
      keys.splice(at, 0, key);
      expect(isOrdKey(key)).toBe(true);
    }
    expect(keys.toSorted()).toStrictEqual(keys);
  });

  it.each([
    "",
    "a",
    "a00",
    "b0",
    "A00000000000000000000000000",
    "a0!",
    "a0 ",
    `a${"1".repeat(200)}`,
  ])("refuses %j", (key) => {
    expect(isOrdKey(key)).toBe(false);
  });
});
