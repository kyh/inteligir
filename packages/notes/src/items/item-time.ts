// An item's `saved` and `fetched` instants. Import-free, and never Date.parse: its reading of a
// date-only string or an offset differs across runtimes, so the arithmetic is Date.UTC's alone.

const DATE_RE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;
const INSTANT_RE =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[Tt](?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:\.(?<fraction>\d+))?)?(?<zone>[Zz]|(?<sign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/u;

const MS_PER_MINUTE = 60_000;

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

const numberOf = (text: string | undefined): number => (text === undefined ? 0 : Number(text));

// Date.UTC reads a year under 100 as 19xx, so such a year is set after the fact
const utcMs = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
): number => {
  const at = new Date(Date.UTC(2000, month - 1, day, hour, minute, second, ms));
  at.setUTCFullYear(year);
  return at.getTime();
};

const validDate = (year: number, month: number, day: number): boolean =>
  month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);

// epoch ms for `YYYY-MM-DD` (UTC midnight) or `YYYY-MM-DDTHH:MM[:SS[.fff]](Z|±HH:MM)`; null for
// anything else, an impossible date (`2026-02-30`) or time among it
export const parseItemTime = (value: string): number | null => {
  const text = value.trim();
  const date = DATE_RE.exec(text)?.groups;
  if (date !== undefined) {
    const year = numberOf(date["year"]);
    const month = numberOf(date["month"]);
    const day = numberOf(date["day"]);
    return validDate(year, month, day) ? utcMs(year, month, day, 0, 0, 0, 0) : null;
  }
  const instant = INSTANT_RE.exec(text)?.groups;
  if (instant === undefined) {
    return null;
  }
  const year = numberOf(instant["year"]);
  const month = numberOf(instant["month"]);
  const day = numberOf(instant["day"]);
  const hour = numberOf(instant["hour"]);
  const minute = numberOf(instant["minute"]);
  const second = numberOf(instant["second"]);
  const offsetHour = numberOf(instant["offsetHour"]);
  const offsetMinute = numberOf(instant["offsetMinute"]);
  if (
    !validDate(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }
  const ms = numberOf((instant["fraction"] ?? "").slice(0, 3).padEnd(3, "0"));
  const offset = (instant["sign"] === "-" ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  return utcMs(year, month, day, hour, minute, second, ms) - offset * MS_PER_MINUTE;
};

// `YYYY-MM-DDTHH:MM:SSZ`, the one spelling every writer stores; milliseconds are dropped
export const formatItemTime = (ms: number): string => `${new Date(ms).toISOString().slice(0, 19)}Z`;
