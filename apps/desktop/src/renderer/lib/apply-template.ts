// Pure helpers for the templates + daily-note conventions (plan 020). No
// bridge, no React — just string/date math, so they unit-test in isolation and
// stay byte-honest: template application substitutes ONLY the fixed placeholder
// set, leaving every other byte (frontmatter, whitespace, markdown) untouched.

/** ui-state keys + defaults for the Settings → Notes section. The palette and
 * the settings panel both read these, so they live with the pure helpers. */
export const DAILY_FOLDER_KEY = "notes.dailyFolder";
export const DAILY_FORMAT_KEY = "notes.dailyFilenameFormat";
export const DEFAULT_DAILY_FOLDER = "journal";
export const DEFAULT_DAILY_FORMAT = "YYYY-MM-DD";

/** The template folder convention and the optional daily-note seed template. */
export const TEMPLATES_DIR = "templates";
export const DAILY_TEMPLATE_PATH = "templates/daily.md";

/** Is this vault path a template note (`templates/*.md`)? */
export function isTemplatePath(path: string): boolean {
  return path.startsWith(`${TEMPLATES_DIR}/`) && /\.md$/i.test(path);
}

/** Zero-pad a number to two digits (local-time date parts). */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Today's date as `YYYY-MM-DD` in LOCAL time — what `{{date}}` expands to.
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

/** Substitute the fixed template placeholders in one pass. ONLY `{{date}}` and
 * `{{title}}` are replaced; a substituted value is never re-scanned (a title
 * that happens to contain `{{date}}` is left literal), and text with no
 * placeholders comes back byte-identical. */
export function applyTemplate(template: string, vars: { title: string; date: string }): string {
  return template.replaceAll(/\{\{(date|title)\}\}/g, (_match, key: string) =>
    key === "date" ? vars.date : vars.title,
  );
}
