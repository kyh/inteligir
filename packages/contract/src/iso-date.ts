const pad2 = (n: number) => String(n).padStart(2, "0");

export const formatIsoDate = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const ISO_DATE_RE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

interface CalendarDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const calendarDay = (value: string) => {
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

  return (year >= 1000 && holds ? { day, month, year } : null) satisfies CalendarDay | null;
};

export const isIsoDate = (value: string) => calendarDay(value) !== null;

export const parseIsoDate = (value: string) => {
  const at = calendarDay(value);

  return (at === null ? null : new Date(at.year, at.month - 1, at.day)) satisfies Date | null;
};
