const pad2 = (n: number): string => String(n).padStart(2, "0");

// local time, not toISOString's UTC
export const formatIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export const formatIsoTime = (date: Date): string =>
  `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

const ISO_DATE_RE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

// two digits that are a multiple of 4, from 12
const MULTIPLE_OF_FOUR = String.raw`(?:[2468][048]|[13579][26])`;
const MONTH_DAY = String.raw`(?:(?:0[1-9]|1[0-2])-(?:0[1-9]|1\d|2[0-8])|(?:0[13-9]|1[0-2])-(?:29|30)|(?:0[13578]|1[02])-31)`;
const LEAP_YEAR = String.raw`(?:[1-9]\d(?:0[48]|${MULTIPLE_OF_FOUR})|${MULTIPLE_OF_FOUR}00)`;

// exactly the values parseIsoDate reads, for a reader that cannot call it: a serializer's unsafe
// pattern is a regex. A year from 1000, the years formatIsoDate writes back in four digits, and
// February 29 in a Gregorian leap year alone.
export const ISO_DATE_PATTERN = String.raw`(?:[1-9]\d{3}-${MONTH_DAY}|${LEAP_YEAR}-02-29)`;

// local time: `new Date("YYYY-MM-DD")` is UTC midnight, a day early west of Greenwich. The Date
// constructor rolls an impossible day into the next month, so a value that does not format back
// to itself names no date.
export const parseIsoDate = (value: string): Date | null => {
  const groups = ISO_DATE_RE.exec(value)?.groups;
  if (groups === undefined) {
    return null;
  }
  const date = new Date(Number(groups.year), Number(groups.month) - 1, Number(groups.day));
  return formatIsoDate(date) === value ? date : null;
};
