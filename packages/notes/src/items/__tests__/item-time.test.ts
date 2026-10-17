import { describe, expect, it } from "vitest";

import { formatItemTime, parseItemTime } from "../item-time";

describe("parseItemTime", () => {
  it.each([
    ["2026-10-17", Date.UTC(2026, 9, 17)],
    ["  2026-10-17  ", Date.UTC(2026, 9, 17)],
    ["2024-02-29", Date.UTC(2024, 1, 29)],
    ["2026-10-17T09:12:30Z", Date.UTC(2026, 9, 17, 9, 12, 30)],
    ["2026-10-17T09:12Z", Date.UTC(2026, 9, 17, 9, 12)],
    ["2026-10-17T09:12:30.123Z", Date.UTC(2026, 9, 17, 9, 12, 30, 123)],
    ["2026-10-17T09:12:30.1Z", Date.UTC(2026, 9, 17, 9, 12, 30, 100)],
    ["2026-10-17T09:12:30.123456Z", Date.UTC(2026, 9, 17, 9, 12, 30, 123)],
    ["2026-10-17T09:12:30+02:00", Date.UTC(2026, 9, 17, 7, 12, 30)],
    ["2026-10-17T09:12:30-05:30", Date.UTC(2026, 9, 17, 14, 42, 30)],
    ["2026-10-17t09:12:30z", Date.UTC(2026, 9, 17, 9, 12, 30)],
  ])("%s", (text, expected) => {
    expect(parseItemTime(text)).toBe(expected);
  });

  it.each([
    "2026-02-29",
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

  it("keeps a year under 100 as written", () => {
    const ms = parseItemTime("0050-03-01");
    expect(ms).not.toBeNull();
    expect(formatItemTime(ms ?? 0)).toBe("0050-03-01T00:00:00Z");
  });
});

describe("formatItemTime", () => {
  it("writes seconds and Z, dropping milliseconds", () => {
    expect(formatItemTime(Date.UTC(2026, 9, 17, 9, 12, 30, 999))).toBe("2026-10-17T09:12:30Z");
  });

  it("round-trips through the parser at second precision", () => {
    for (let ms = Date.UTC(1999, 0, 1); ms < Date.UTC(2040, 0, 1); ms += 86_399_517) {
      expect(parseItemTime(formatItemTime(ms))).toBe(Math.floor(ms / 1000) * 1000);
    }
  });
});
