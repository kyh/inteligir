import { describe, expect, it } from "vitest";

import { createFsStamp } from "../clock";

describe("createFsStamp", () => {
  it("formats a filesystem-safe ISO stamp (no ':' or '.')", () => {
    const stamp = createFsStamp(() => new Date("2026-07-05T12:34:56.000Z"));
    expect(stamp()).toBe("2026-07-05T12-34-56-000Z");
    expect(stamp()).not.toContain(":");
    expect(stamp()).not.toContain(".");
  });

  it("reads the clock on every call", () => {
    let seconds = 0;
    const stamp = createFsStamp(() => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds++)));
    expect(stamp()).not.toBe(stamp());
  });
});
