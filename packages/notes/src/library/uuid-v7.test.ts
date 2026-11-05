import { describe, expect, it } from "vitest";
import { z } from "zod";

import { uuidV7 } from "./uuid-v7";

const v7 = z.uuidv7();

describe("a minted id", () => {
  it("is a UUIDv7 whose first six bytes are the time, so ids sort as they were made", () => {
    const at = Date.UTC(2026, 9, 1, 12, 30);
    const extremes = [new Uint8Array(16), new Uint8Array(16).fill(0xff)];
    for (const random of extremes) {
      const id = uuidV7(at, random);
      expect(v7.validate(id), id).toBe(true);
      expect(Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16)).toBe(at);
    }
    const earlier = uuidV7(at, new Uint8Array(16).fill(0xff));
    const later = uuidV7(at + 1, new Uint8Array(16));
    expect(earlier < later).toBe(true);
  });

  it("refuses random bytes of any other length", () => {
    expect(() => uuidV7(0, new Uint8Array(15))).toThrow(RangeError);
  });
});
