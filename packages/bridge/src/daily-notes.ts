// Isomorphic helpers for the templates + periodic-note conventions: the host
// (deep-link capture drain) and the renderer (⌘D, palette, Settings → Notes)
// share one source of truth.
// No bridge, no React, no node — just string math; the pure date→path fns
// live in @repo/notes/daily-path. Template application substitutes ONLY
// the fixed placeholder set, leaving every other byte (frontmatter,
// whitespace, markdown) untouched.

/** ui-state keys + defaults for the Settings → Notes section. The palette,
 * the settings panel, and the host's capture drain all read these, so they
 * live with the shared helpers.
 *
 * These four names and — critically — these four VALUES are frozen. The key
 * STRINGS address rows in the on-disk ui-state store, so renaming one silently
 * resets every existing user's daily-note configuration. Every other cadence
 * (CADENCES below) sits AROUND them; none of them may be folded into a
 * generalized key shape. */
export const DAILY_FOLDER_KEY = "notes.dailyFolder";
export const DAILY_FORMAT_KEY = "notes.dailyFilenameFormat";
export const DEFAULT_DAILY_FOLDER = "journal";
export const DEFAULT_DAILY_FORMAT = "YYYY-MM-DD";

/** The template folder convention and the optional daily-note seed template. */
export const TEMPLATES_DIR = "templates";
export const DAILY_TEMPLATE_PATH = "templates/daily.md";

// ---- Cadences ---------------------------------------------------------------

/** The periodic-note cadences. Daily is the one ⌘D, deep-link capture and task
 * scheduling reach for; weekly and monthly are the SAME machine with a
 * different folder + filename format. */
export type Cadence = "daily" | "weekly" | "monthly";

/** Everything that differs between cadences, in one record per cadence — the
 * point of the lookup table below is that there is exactly ONE place to look
 * when adding "quarterly", instead of three parallel constant sets and three
 * parallel hooks/commands/settings rows to keep in step. */
export type CadenceConfig = {
  /** Discriminant — a config always knows which cadence it describes. */
  readonly cadence: Cadence;
  /** ui-state key holding the user's folder for this cadence. */
  readonly folderKey: string;
  /** ui-state key holding the user's filename format for this cadence. */
  readonly formatKey: string;
  readonly defaultFolder: string;
  /** Filename pattern in @repo/notes/daily-path's token language. */
  readonly defaultFormat: string;
  /** Optional seed template; absent file ⇒ the note starts empty. */
  readonly templatePath: string;
  /** Palette command label ("Open today's note"). */
  readonly commandLabel: string;
  /** Settings → Notes group heading ("Weekly note"). */
  readonly settingsLabel: string;
  /** The tokens this cadence's format is expected to use, for the Settings
   * hint. Purely descriptive — formatDatePattern accepts all of them always. */
  readonly formatTokens: string;
};

/**
 * The cadence table. Weekly defaults to the ISO week-year + week number
 * (`GGGG-Www` → `2026-W28.md`), which is what makes a week note that spans a
 * new year file correctly; monthly needs no new tokens at all. The weekly and
 * monthly notes get their own subfolders by default so a vault that already
 * has a year of `journal/YYYY-MM-DD.md` doesn't suddenly interleave three
 * cadences in one directory.
 */
export const CADENCES: Readonly<Record<Cadence, CadenceConfig>> = {
  daily: {
    cadence: "daily",
    commandLabel: "Open today's note",
    defaultFolder: DEFAULT_DAILY_FOLDER,
    defaultFormat: DEFAULT_DAILY_FORMAT,
    folderKey: DAILY_FOLDER_KEY,
    formatKey: DAILY_FORMAT_KEY,
    formatTokens: "YYYY, MM, DD",
    settingsLabel: "Daily note",
    templatePath: DAILY_TEMPLATE_PATH,
  },
  weekly: {
    cadence: "weekly",
    commandLabel: "Open this week's note",
    defaultFolder: "journal/weekly",
    defaultFormat: "GGGG-Www",
    folderKey: "notes.weeklyFolder",
    formatKey: "notes.weeklyFilenameFormat",
    formatTokens: "GGGG = ISO week-year, ww = week",
    settingsLabel: "Weekly note",
    templatePath: `${TEMPLATES_DIR}/weekly.md`,
  },
  monthly: {
    cadence: "monthly",
    commandLabel: "Open this month's note",
    defaultFolder: "journal/monthly",
    defaultFormat: "YYYY-MM",
    folderKey: "notes.monthlyFolder",
    formatKey: "notes.monthlyFilenameFormat",
    formatTokens: "YYYY, MM",
    settingsLabel: "Monthly note",
    templatePath: `${TEMPLATES_DIR}/monthly.md`,
  },
};

/** Display order for every surface that lists cadences (Settings rows, palette
 * commands). `Object.keys` would widen to `string[]`, so the order is stated
 * once here and iterated everywhere. */
export const CADENCE_ORDER: readonly Cadence[] = ["daily", "weekly", "monthly"];

/** Is this vault path a template note (`templates/*.md`)? */
export function isTemplatePath(path: string): boolean {
  return path.startsWith(`${TEMPLATES_DIR}/`) && /\.md$/i.test(path);
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
