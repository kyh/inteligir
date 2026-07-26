// Pure date↔path math for the periodic-note convention (daily, weekly,
// monthly). FORWARD: a date + the Settings → Notes folder/format → a
// vault-relative path. INVERSE: a path (or bare formatted text) back to its
// ISO date — DAILY only, because only a `YYYY-MM-DD`-shaped pattern names a
// single day. No I/O, no clock: callers pass the Date. Platform-neutral so the
// desktop renderer, the host's deep-link capture drain, and mobile all compute
// the SAME path for "today's note"; both directions live in this ONE module so
// they can never drift (pinned by the round-trip tests).

/** Zero-pad a number to two digits (local-time date parts). */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Milliseconds in a 24h day — only ever used on two LOCAL-midnight dates that
 * are then rounded to whole days, so a 23h/25h DST day can't shift the count. */
const DAY_MS = 86_400_000;

/** An ISO-8601 week: the week number (1–53) and the WEEK-YEAR it belongs to.
 * The week-year is not always the calendar year — that's the whole point of
 * returning it (2021-01-01 is 2020-W53; 2019-12-30 is 2020-W01). */
export type IsoWeek = { weekYear: number; week: number };

/**
 * ISO-8601 week number + week-year for a local date. Hand-rolled — this repo
 * carries no date library and won't grow one for five lines of arithmetic.
 *
 * The rule in one sentence: a week runs Monday→Sunday and belongs to the year
 * containing its THURSDAY. So the algorithm shifts the date to its week's
 * Thursday first, reads the year off that, and counts whole weeks from that
 * year's Jan 1 — which makes week 1 fall out for free (the Thursday of week 1
 * is always Jan 1–7, i.e. 0–6 days after Jan 1). Both year-boundary traps and
 * the 53-week years are consequences of the Thursday shift, not special cases.
 */
export function isoWeek(date: Date): IsoWeek {
  // Local midnight copy: the input may carry a time-of-day, and day arithmetic
  // on a mid-afternoon Date can cross a DST edge.
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // ISO weekday: Monday = 1 … Sunday = 7 (JS puts Sunday at 0).
  const isoDay = thursday.getDay() === 0 ? 7 : thursday.getDay();
  thursday.setDate(thursday.getDate() + 4 - isoDay);
  const weekYear = thursday.getFullYear();
  const jan1 = new Date(weekYear, 0, 1);
  const daysFromJan1 = Math.round((thursday.getTime() - jan1.getTime()) / DAY_MS);
  return { week: Math.floor(daysFromJan1 / 7) + 1, weekYear };
}

/** A date as `YYYY-MM-DD` in LOCAL time — what `{{date}}` expands to.
 * Hand-rolled (no dayjs/date-fns): three zero-padded local components. */
export function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Expand the periodic-note filename tokens (local time). Any other character
 * passes through literally. Longest tokens first so `YYYY` never leaves a
 * stray `YY`.
 *
 * | token  | meaning                              | example |
 * | ------ | ------------------------------------ | ------- |
 * | `YYYY` | calendar year                        | 2026    |
 * | `MM`   | month, zero-padded                   | 07      |
 * | `DD`   | day of month, zero-padded            | 09      |
 * | `GGGG` | ISO WEEK-year (≠ calendar year!)     | 2026    |
 * | `ww`   | ISO week number, zero-padded         | 28      |
 *
 * The week token is deliberately LOWERCASE: this pattern language has no
 * escape syntax, so an uppercase `WW` would make the natural weekly format
 * `GGGG-WWW` ambiguous (`WW` would eat the literal separator and emit
 * `2026-28W`). With `ww`, a literal `W` is just a pass-through character and
 * the default `GGGG-Www` reads `2026-W28` — the same filename Obsidian's
 * periodic-notes default (`gggg-[W]ww`) produces. The cost is that a pattern
 * containing a literal lowercase "ww" is not expressible; no realistic
 * filename format does.
 */
export function formatDatePattern(pattern: string, date: Date): string {
  const { week, weekYear } = isoWeek(date);
  return pattern
    .replaceAll("YYYY", String(date.getFullYear()))
    .replaceAll("GGGG", String(weekYear))
    .replaceAll("MM", pad2(date.getMonth() + 1))
    .replaceAll("DD", pad2(date.getDate()))
    .replaceAll("ww", pad2(week));
}

/** Vault-relative path for a periodic note: `<folder>/<formatted-date>.md`.
 * A blank folder puts the note at the vault root. Cadence-agnostic — daily vs
 * weekly vs monthly lives ENTIRELY in the folder + filename format the caller
 * passes (that's what makes weekly/monthly parameterization rather than new
 * machinery). */
export function periodicNotePath(folder: string, filenameFormat: string, date: Date): string {
  const cleanFolder = folder.replaceAll(/^\/+|\/+$/g, "").trim();
  const file = `${formatDatePattern(filenameFormat, date)}.md`;
  return cleanFolder === "" ? file : `${cleanFolder}/${file}`;
}

/** The daily cadence's path builder — `periodicNotePath` with a daily-shaped
 * pattern, nothing more. It keeps its own name (rather than the callers being
 * rewritten) because the host capture drain, mobile's capture and the fixture
 * Bridge each mean "TODAY's note" specifically, and reading
 * `periodicNotePath` there would leave a reviewer wondering which cadence they
 * were looking at. Delegating rather than aliasing so the two stay separately
 * documentable. */
export function dailyNotePath(folder: string, filenameFormat: string, date: Date): string {
  return periodicNotePath(folder, filenameFormat, date);
}

// ---- Inverse (path/text → date) ---------------------------------------------
//
// DAILY only, on purpose: a weekly/monthly pattern names a RANGE, not a day,
// so it can't produce an ISO date. Such patterns fall out as `null` here for
// free — compilePattern requires exactly one each of YYYY/MM/DD, and `GGGG`/
// `ww` are unknown characters to it — which is exactly the right answer for
// the one caller (task scheduling, which asks "is this note a given day's
// daily note?").

const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

type DateToken = "YYYY" | "MM" | "DD";

/** Compile a filename pattern into a capturing regex + the token order its
 * groups appear in. Null when the pattern is ambiguous as an inverse: each of
 * YYYY/MM/DD must appear EXACTLY once (a repeated or missing token can't be
 * read back). Longest token first, mirroring formatDatePattern. */
function compilePattern(filenameFormat: string): { re: RegExp; order: DateToken[] } | null {
  const order: DateToken[] = [];
  let pattern = "";
  let i = 0;
  while (i < filenameFormat.length) {
    if (filenameFormat.startsWith("YYYY", i)) {
      order.push("YYYY");
      pattern += "(\\d{4})";
      i += 4;
    } else if (filenameFormat.startsWith("MM", i)) {
      order.push("MM");
      pattern += "(\\d{2})";
      i += 2;
    } else if (filenameFormat.startsWith("DD", i)) {
      order.push("DD");
      pattern += "(\\d{2})";
      i += 2;
    } else {
      pattern += filenameFormat.charAt(i).replace(REGEXP_SPECIALS, "\\$&");
      i += 1;
    }
  }
  const counts = { YYYY: 0, MM: 0, DD: 0 };
  for (const token of order) counts[token] += 1;
  if (counts.YYYY !== 1 || counts.MM !== 1 || counts.DD !== 1) return null;
  return { re: new RegExp(`^${pattern}$`), order };
}

/** Read `text` (a bare formatted date, no `.md`) back through a filename
 * pattern → ISO `YYYY-MM-DD`, or null. Real-calendar validation: the parts
 * must round-trip through a local Date (2026-13-40 never parses). */
export function parseDateByPattern(text: string, filenameFormat: string): string | null {
  const compiled = compilePattern(filenameFormat);
  if (compiled === null) return null;
  const match = compiled.re.exec(text);
  if (match === null) return null;
  const parts = { YYYY: 0, MM: 0, DD: 0 };
  for (const [i, token] of compiled.order.entries()) {
    parts[token] = Number(match[i + 1] ?? "");
  }
  const date = new Date(parts.YYYY, parts.MM - 1, parts.DD);
  const real =
    date.getFullYear() === parts.YYYY &&
    date.getMonth() === parts.MM - 1 &&
    date.getDate() === parts.DD;
  return real ? formatIsoDate(date) : null;
}

/** The inverse of dailyNotePath: a vault-relative path back to its ISO date,
 * or null when it isn't a daily note under `folder` with `filenameFormat`
 * (same cleanFolder rule — a blank folder means vault-root dailies, and a
 * pattern containing `/` matches its nested folders literally). */
export function dateFromDailyPath(
  path: string,
  folder: string,
  filenameFormat: string,
): string | null {
  const cleanFolder = folder.replaceAll(/^\/+|\/+$/g, "").trim();
  const prefix = cleanFolder === "" ? "" : `${cleanFolder}/`;
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  if (!rest.endsWith(".md")) return null;
  return parseDateByPattern(rest.slice(0, -3), filenameFormat);
}
