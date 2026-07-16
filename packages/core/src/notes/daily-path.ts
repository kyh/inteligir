// Pure date→path math for the daily-note convention — the FORWARD direction
// (a date + the Settings → Notes folder/format → a vault-relative path). No
// I/O, no clock: callers pass the Date. Platform-neutral so the desktop
// renderer, the host's deep-link capture drain, and mobile all compute the
// SAME path for "today's note"; when an inverse (path → date) is needed it
// must live in this module so the two directions can never drift.

/** Zero-pad a number to two digits (local-time date parts). */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** A date as `YYYY-MM-DD` in LOCAL time — what `{{date}}` expands to.
 * Hand-rolled (no dayjs/date-fns): three zero-padded local components. */
export function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Expand `YYYY`/`MM`/`DD` tokens in a daily-note filename pattern (local
 * time). Any other characters pass through literally. Longest tokens first so
 * `YYYY` never leaves a stray `YY`. */
export function formatDatePattern(pattern: string, date: Date): string {
  return pattern
    .replaceAll("YYYY", String(date.getFullYear()))
    .replaceAll("MM", pad2(date.getMonth() + 1))
    .replaceAll("DD", pad2(date.getDate()));
}

/** Vault-relative path for the daily note: `<folder>/<formatted-date>.md`.
 * A blank folder puts the note at the vault root. */
export function dailyNotePath(folder: string, filenameFormat: string, date: Date): string {
  const cleanFolder = folder.replaceAll(/^\/+|\/+$/g, "").trim();
  const file = `${formatDatePattern(filenameFormat, date)}.md`;
  return cleanFolder === "" ? file : `${cleanFolder}/${file}`;
}
