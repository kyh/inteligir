const pad2 = (n: number): string => String(n).padStart(2, "0");

// local time, not toISOString's UTC
export const formatIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const ISO_DATE_RE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

interface CalendarDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

// A year from 1000, the years formatIsoDate writes back in four digits, and a day the calendar
// holds: Date.UTC rolls an impossible day into the next month, so one that does not read back
// names no date.
const calendarDay = (value: string): CalendarDay | null => {
  const groups = ISO_DATE_RE.exec(value)?.groups;
  if (groups === undefined) {
    return null;
  }
  const year = Number(groups.year);
  const month = Number(groups.month);
  const day = Number(groups.day);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const holds =
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
  return year >= 1000 && holds ? { day, month, year } : null;
};

export const isIsoDate = (value: string): boolean => calendarDay(value) !== null;

// local time: `new Date("YYYY-MM-DD")` is UTC midnight, a day early west of Greenwich
export const parseIsoDate = (value: string): Date | null => {
  const at = calendarDay(value);
  return at === null ? null : new Date(at.year, at.month - 1, at.day);
};
