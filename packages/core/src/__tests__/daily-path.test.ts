import { describe, expect, it } from "vitest";

import {
  dailyNotePath,
  dateFromDailyPath,
  formatDatePattern,
  formatIsoDate,
  parseDateByPattern,
} from "../notes/daily-path";

describe("date formatting", () => {
  it("zero-pads iso date components (local time)", () => {
    // Local-time constructor: month index 0 = January, day 5.
    expect(formatIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatIsoDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("expands YYYY/MM/DD tokens in a pattern", () => {
    const date = new Date(2026, 6, 9); // 2026-07-09
    expect(formatDatePattern("YYYY-MM-DD", date)).toBe("2026-07-09");
    expect(formatDatePattern("YYYY/MM/DD", date)).toBe("2026/07/09");
    expect(formatDatePattern("Daily MM.DD.YYYY", date)).toBe("Daily 07.09.2026");
  });
});

describe("dailyNotePath", () => {
  const date = new Date(2026, 6, 9);
  it("joins folder and formatted filename", () => {
    expect(dailyNotePath("journal", "YYYY-MM-DD", date)).toBe("journal/2026-07-09.md");
  });
  it("strips surrounding slashes from the folder", () => {
    expect(dailyNotePath("/journal/", "YYYY-MM-DD", date)).toBe("journal/2026-07-09.md");
  });
  it("puts the note at the root when the folder is blank", () => {
    expect(dailyNotePath("", "YYYY-MM-DD", date)).toBe("2026-07-09.md");
  });

  it("round-trips date → path → date for the default pattern", () => {
    // The forward mapping is the contract an inverse (dateFromDailyPath) must
    // honor when it lands beside it: the default pattern's path must recover
    // the exact local date components. Pin it so the two can never drift.
    const days = [new Date(2026, 0, 1), new Date(2026, 6, 9), new Date(2024, 1, 29)];
    for (const day of days) {
      const path = dailyNotePath("journal", "YYYY-MM-DD", day);
      const match = /^journal\/(\d{4})-(\d{2})-(\d{2})\.md$/.exec(path);
      expect(match).not.toBeNull();
      if (!match) continue;
      const recovered = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      expect(formatIsoDate(recovered)).toBe(formatIsoDate(day));
    }
  });
});

describe("dateFromDailyPath (the inverse)", () => {
  it("round-trips through dailyNotePath for every token arrangement", () => {
    const date = new Date(2026, 6, 9);
    const cases: Array<[string, string]> = [
      ["journal", "YYYY-MM-DD"],
      ["daily", "DD-MM-YYYY"],
      ["notes/log", "Daily MM.DD.YYYY"],
      ["", "YYYY-MM-DD"],
      ["journal", "YYYY/MM/DD"], // nested-folder pattern: `/` matches literally
    ];
    for (const [folder, format] of cases) {
      const path = dailyNotePath(folder, format, date);
      expect(dateFromDailyPath(path, folder, format)).toBe("2026-07-09");
    }
  });

  it("applies the same cleanFolder rule as the forward direction", () => {
    expect(dateFromDailyPath("journal/2026-07-09.md", "/journal/", "YYYY-MM-DD")).toBe(
      "2026-07-09",
    );
  });

  it("returns null off the configured folder, format, or extension", () => {
    expect(dateFromDailyPath("notes/2026-07-09.md", "journal", "YYYY-MM-DD")).toBeNull();
    expect(dateFromDailyPath("2026-07-09.md", "journal", "YYYY-MM-DD")).toBeNull();
    expect(dateFromDailyPath("journal/2026-07-09.txt", "journal", "YYYY-MM-DD")).toBeNull();
    expect(dateFromDailyPath("journal/07-09.md", "journal", "YYYY-MM-DD")).toBeNull();
    // Blank folder means vault-ROOT dailies — nested paths don't match.
    expect(dateFromDailyPath("journal/2026-07-09.md", "", "YYYY-MM-DD")).toBeNull();
  });

  it("rejects impossible calendar dates (real-date validation)", () => {
    expect(dateFromDailyPath("journal/2026-13-40.md", "journal", "YYYY-MM-DD")).toBeNull();
    expect(dateFromDailyPath("journal/2026-02-30.md", "journal", "YYYY-MM-DD")).toBeNull();
    // A leap day parses only in a leap year.
    expect(dateFromDailyPath("journal/2024-02-29.md", "journal", "YYYY-MM-DD")).toBe("2024-02-29");
    expect(dateFromDailyPath("journal/2026-02-29.md", "journal", "YYYY-MM-DD")).toBeNull();
  });

  it("fails null for ambiguous patterns (repeated or missing tokens)", () => {
    expect(parseDateByPattern("2026-07-2026", "YYYY-MM-YYYY")).toBeNull();
    expect(parseDateByPattern("2026-07", "YYYY-MM")).toBeNull();
    expect(parseDateByPattern("07-09", "MM-DD")).toBeNull();
  });

  it("treats regex specials in the pattern as literals", () => {
    expect(parseDateByPattern("(2026) 07+09", "(YYYY) MM+DD")).toBe("2026-07-09");
    expect(parseDateByPattern("2026x07x09", "YYYY.MM.DD")).toBeNull();
  });
});
