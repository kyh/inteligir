const pad2 = (n: number): string => String(n).padStart(2, "0");

// local time, not toISOString's UTC
export const formatIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export const formatIsoTime = (date: Date): string =>
  `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

const ISO_DATE_RE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

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
