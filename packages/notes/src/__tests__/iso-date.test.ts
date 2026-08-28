import { describe, expect, it } from "vitest";

import { formatIsoDate } from "../iso-date";

describe("formatIsoDate", () => {
  it("zero-pads iso date components (local time)", () => {
    // Local-time constructor: month index 0 = January, day 5.
    expect(formatIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatIsoDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("ignores time-of-day", () => {
    expect(formatIsoDate(new Date(2026, 6, 9, 23, 59, 59))).toBe("2026-07-09");
  });
});
