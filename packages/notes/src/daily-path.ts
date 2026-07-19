// Pure date↔path math for the daily-note convention. FORWARD: a date + the
// Settings → Notes folder/format → a vault-relative path. INVERSE: a path (or
// bare formatted text) back to its ISO date. No I/O, no clock: callers pass
// the Date. Platform-neutral so the desktop renderer, the host's deep-link
// capture drain, and mobile all compute the SAME path for "today's note";
// both directions live in this ONE module so they can never drift (pinned by
// the round-trip tests).

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

// ---- Inverse (path/text → date) ---------------------------------------------

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
