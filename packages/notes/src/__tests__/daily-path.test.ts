import { describe, expect, it } from "vitest";

import {
  dailyNotePath,
  dateFromDailyPath,
  formatDatePattern,
  formatIsoDate,
  isoWeek,
  parseDateByPattern,
  periodicNotePath,
} from "../daily-path";

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

  it("expands the ISO week tokens, leaving a literal W alone", () => {
    const date = new Date(2026, 6, 9); // 2026-07-09, ISO 2026-W28
    expect(formatDatePattern("GGGG-Www", date)).toBe("2026-W28");
    expect(formatDatePattern("GGGG/ww", date)).toBe("2026/28");
    // The monthly cadence needs no new tokens at all.
    expect(formatDatePattern("YYYY-MM", date)).toBe("2026-07");
  });

  it("expands GGGG to the WEEK-year, which can differ from YYYY", () => {
    // 2021-01-01 is a Friday: ISO week 2020-W53. A weekly pattern using YYYY
    // instead of GGGG would file it under 2021 and collide with 2021-W53.
    const jan1 = new Date(2021, 0, 1);
    expect(formatDatePattern("YYYY-Www", jan1)).toBe("2021-W53");
    expect(formatDatePattern("GGGG-Www", jan1)).toBe("2020-W53");
  });
});

// ISO-8601 (the convention Obsidian's periodic-notes plugin defaults to):
// weeks run Monday→Sunday and belong to the year containing their Thursday.
// Every case below is a boundary the Thursday rule exists to get right — an
// approximate "day-of-year / 7" implementation fails all six.
describe("isoWeek", () => {
  const cases: Array<[string, Date, number, number]> = [
    // Plain mid-year date — the baseline.
    ["2026-07-09 (Thu, ordinary week)", new Date(2026, 6, 9), 2026, 28],
    // Trap 1: a JANUARY date belonging to the PREVIOUS week-year.
    ["2021-01-01 (Fri) → 2020-W53", new Date(2021, 0, 1), 2020, 53],
    ["2023-01-01 (Sun) → 2022-W52", new Date(2023, 0, 1), 2022, 52],
    // Trap 2: a DECEMBER date belonging to NEXT year's week 1.
    ["2019-12-30 (Mon) → 2020-W01", new Date(2019, 11, 30), 2020, 1],
    // 53-week years: Jan 1 falls on a Thursday (2015), or it's a leap year
    // starting on a Wednesday (2020). These are the only two shapes that
    // produce a W53, and a naive 52-week assumption drops the last week.
    ["2015-12-31 (Thu) → 2015-W53", new Date(2015, 11, 31), 2015, 53],
    ["2020-12-31 (Thu) → 2020-W53", new Date(2020, 11, 31), 2020, 53],
  ];

  for (const [label, date, weekYear, week] of cases) {
    it(label, () => {
      expect(isoWeek(date)).toEqual({ week, weekYear });
    });
  }

  it("puts the whole Mon→Sun week under one week number", () => {
    // 2020-W53 runs Mon 2020-12-28 through Sun 2021-01-03 — it spans the
    // calendar-year boundary, and every day in it must file to the same note.
    const days = [
      new Date(2020, 11, 28),
      new Date(2020, 11, 31),
      new Date(2021, 0, 1),
      new Date(2021, 0, 3),
    ];
    for (const day of days) expect(isoWeek(day)).toEqual({ week: 53, weekYear: 2020 });
    // The very next day starts 2021-W01.
    expect(isoWeek(new Date(2021, 0, 4))).toEqual({ week: 1, weekYear: 2021 });
  });

  it("ignores time-of-day (a Date with hours lands in the same week)", () => {
    expect(isoWeek(new Date(2026, 6, 9, 23, 59, 59))).toEqual(isoWeek(new Date(2026, 6, 9)));
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

  it("delegates to periodicNotePath — every cadence shares one builder", () => {
    const day = new Date(2026, 6, 9);
    expect(dailyNotePath("journal", "YYYY-MM-DD", day)).toBe(
      periodicNotePath("journal", "YYYY-MM-DD", day),
    );
    const jan1 = new Date(2021, 0, 1);
    expect(periodicNotePath("journal/weekly", "GGGG-Www", jan1)).toBe("journal/weekly/2020-W53.md");
    expect(periodicNotePath("journal/monthly", "YYYY-MM", jan1)).toBe("journal/monthly/2021-01.md");
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

  it("refuses weekly/monthly patterns — they name a range, not a day", () => {
    expect(parseDateByPattern("2026-W28", "GGGG-Www")).toBeNull();
    expect(parseDateByPattern("2026-07", "YYYY-MM")).toBeNull();
    expect(
      dateFromDailyPath("journal/weekly/2026-W28.md", "journal/weekly", "GGGG-Www"),
    ).toBeNull();
  });

  it("treats regex specials in the pattern as literals", () => {
    expect(parseDateByPattern("(2026) 07+09", "(YYYY) MM+DD")).toBe("2026-07-09");
    expect(parseDateByPattern("2026x07x09", "YYYY.MM.DD")).toBeNull();
  });
});
