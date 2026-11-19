const DATE_RE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

const INSTANT_RE =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[Tt](?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:\.(?<fraction>\d+))?)?(?<zone>[Zz]|(?<sign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/u;

const MS_PER_MINUTE = 60_000;

const numberOf = (text: string | undefined) => (text === undefined ? 0 : Number(text));

const itemInstant = (ms: number | null) => (ms !== null && ms >= 0 ? ms : null);

const utcMs = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
) => {
  const at = new Date(Date.UTC(2000, month - 1, day, hour, minute, second, ms));
  at.setUTCFullYear(year);

  const holds =
    at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;

  return holds ? at.getTime() : null;
};

export const parseItemTime = (value: string) => {
  const text = value.trim();
  const date = DATE_RE.exec(text)?.groups;

  if (date !== undefined) {
    return itemInstant(
      utcMs(numberOf(date.year), numberOf(date.month), numberOf(date.day), 0, 0, 0, 0),
    );
  }

  const instant = INSTANT_RE.exec(text)?.groups;

  if (instant === undefined) {
    return null;
  }

  const year = numberOf(instant.year);
  const month = numberOf(instant.month);
  const day = numberOf(instant.day);
  const hour = numberOf(instant.hour);
  const minute = numberOf(instant.minute);
  const second = numberOf(instant.second);
  const offsetHour = numberOf(instant.offsetHour);
  const offsetMinute = numberOf(instant.offsetMinute);

  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    return null;
  }

  const ms = numberOf((instant.fraction ?? "").slice(0, 3).padEnd(3, "0"));
  const offset = (instant.sign === "-" ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  const at = utcMs(year, month, day, hour, minute, second, ms);

  return itemInstant(at === null ? null : at - offset * MS_PER_MINUTE);
};

export const formatItemTime = (ms: number) =>
  new Date(ms).toISOString().replace(/\.000Z$/u, "Z") satisfies string;
