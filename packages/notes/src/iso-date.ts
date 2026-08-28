// Local-time ISO date text. No clock: the caller passes the Date, so the same
// function serves the editor's date chips and a note's own heading.

/** Zero-pad a number to two digits (local-time date parts). */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** A date as `YYYY-MM-DD` in LOCAL time. Hand-rolled (no dayjs/date-fns):
 * three zero-padded local components. */
export function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
