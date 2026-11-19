import { describe, expect, it } from "vitest";

import { formatItemTime, parseItemTime } from "./item-time";

describe(parseItemTime, () => {
  it.each([
    ["2026-10-17", Date.UTC(2026, 9, 17)],
    ["  2026-10-17  ", Date.UTC(2026, 9, 17)],
    ["2024-02-29", Date.UTC(2024, 1, 29)],
    ["2000-02-29", Date.UTC(2000, 1, 29)],
    ["2026-10-17T09:12:30Z", Date.UTC(2026, 9, 17, 9, 12, 30)],
    ["2026-10-17T09:12Z", Date.UTC(2026, 9, 17, 9, 12)],
    ["2026-10-17T09:12:30.123Z", Date.UTC(2026, 9, 17, 9, 12, 30, 123)],
    ["2026-10-17T09:12:30.1Z", Date.UTC(2026, 9, 17, 9, 12, 30, 100)],
    ["2026-10-17T09:12:30.123456Z", Date.UTC(2026, 9, 17, 9, 12, 30, 123)],
    ["2026-10-17T09:12:30+02:00", Date.UTC(2026, 9, 17, 7, 12, 30)],
    ["2026-10-17T09:12:30-05:30", Date.UTC(2026, 9, 17, 14, 42, 30)],
    ["2026-10-17t09:12:30z", Date.UTC(2026, 9, 17, 9, 12, 30)],
    ["1970-01-01", 0],
    ["1970-01-01T01:00:00+01:00", 0],
  ])("%s", (text, expected) => {
    expect(parseItemTime(text)).toBe(expected);
  });

  it.each([
    "2026-02-29",
    "2100-02-29",
    "1900-02-29T00:00:00Z",
    "2026-02-30",
    "2026-13-01",
    "2026-00-10",
    "2026-04-31",
    "2026-10-17T24:00:00Z",
    "2026-10-17T09:60:00Z",
    "2026-10-17T09:12:61Z",
    "2026-10-17T09:12:30+24:00",
    "2026-10-17 09:12:30Z",
    "2026-10-17T09:12:30",
    "17/10/2026",
    "2026-1-7",
    "yesterday",
    "",
  ])("refuses %j", (text) => {
    expect(parseItemTime(text)).toBeNull();
  });

  it.each(["1965-01-01", "1969-12-31T23:59:59Z", "1970-01-01T00:30:00+01:00", "0050-03-01"])(
    "refuses %j, before 1970",
    (text) => {
      expect(parseItemTime(text)).toBeNull();
    },
  );

  it("reads a year under 100 as written, so before 1970, never as 19xx", () => {
    expect(parseItemTime("0075-01-01")).toBeNull();
  });
});

describe(formatItemTime, () => {
  it.each([
    [Date.UTC(2026, 9, 17, 9, 12, 30), "2026-10-17T09:12:30Z"],
    [Date.UTC(2026, 9, 17, 9, 12, 30, 7), "2026-10-17T09:12:30.007Z"],
    [0, "1970-01-01T00:00:00Z"],
  ])("writes %d as %s, which reads back as itself", (ms, text) => {
    expect(formatItemTime(ms)).toBe(text);
    expect(parseItemTime(text)).toBe(ms);
  });
});
