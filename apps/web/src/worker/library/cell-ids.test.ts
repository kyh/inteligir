import { newIdSchema } from "@repo/contract/cloud/library/library-wire";
import { describe, expect, it } from "vitest";

import { uuidV7 } from "./cell-ids";

describe("an item id the cell mints", () => {
  it("is a UUIDv7 whose first six bytes are the time, so ids sort as they were made", () => {
    const at = Date.UTC(2026, 9, 1, 12, 30);
    const extremes = [new Uint8Array(16), new Uint8Array(16).fill(0xff)];
    for (const random of extremes) {
      const id = uuidV7(at, random);
      expect(newIdSchema.safeParse(id).success, id).toBe(true);
      expect(Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16)).toBe(at);
    }
    const earlier = uuidV7(at, new Uint8Array(16).fill(0xff));
    const later = uuidV7(at + 1, new Uint8Array(16));
    expect(earlier < later).toBe(true);
  });
});
