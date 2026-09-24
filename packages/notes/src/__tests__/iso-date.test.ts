import { describe, expect, it } from "vitest";

import { formatIsoDate, parseIsoDate } from "../iso-date";

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

describe("parseIsoDate", () => {
  it("reads a real date as local midnight and round-trips it", () => {
    const date = parseIsoDate("2026-02-28");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(1);
    expect(date?.getDate()).toBe(28);
    expect(date?.getHours()).toBe(0);
    expect(date === null ? null : formatIsoDate(date)).toBe("2026-02-28");
  });

  it.each(["2026-02-31", "2026-13-01", "2026-00-10", "2026-04-31", "2025-02-29"])(
    "refuses %s, which the Date constructor would roll into another day",
    (value) => {
      expect(parseIsoDate(value)).toBeNull();
    },
  );

  it.each(["", "2026-2-28", "2026-02-28T00:00", " 2026-02-28", "tomorrow"])(
    "refuses %j, which is not YYYY-MM-DD",
    (value) => {
      expect(parseIsoDate(value)).toBeNull();
    },
  );
});
