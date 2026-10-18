import { describe, expect, it } from "vitest";

import { ISO_DATE_PATTERN, formatIsoDate, parseIsoDate } from "./iso-date";

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

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

describe("ISO_DATE_PATTERN", () => {
  const pattern = new RegExp(`^${ISO_DATE_PATTERN}$`, "u");

  it("matches exactly what parseIsoDate reads, across the years that bend the calendar", () => {
    const years = [99, 999, 1000, 1004, 1100, 1200, 1900, 2000, 2023, 2024, 2100, 2400, 9996, 9999];
    const mismatches: string[] = [];
    for (const year of years) {
      for (let month = 0; month <= 13; month += 1) {
        for (let day = 0; day <= 32; day += 1) {
          const value = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
          if (pattern.test(value) !== (parseIsoDate(value) !== null)) {
            mismatches.push(value);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});
