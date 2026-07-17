// Isomorphic helpers for the templates + daily-note conventions,
// relocated from the desktop renderer so the host (deep-link capture drain)
// and the renderer (⌘D, palette, Settings → Notes) share one source of truth.
// No bridge, no React, no node — just string math; the pure date→path fns
// live in @repo/core/notes/daily-path. Template application substitutes ONLY
// the fixed placeholder set, leaving every other byte (frontmatter,
// whitespace, markdown) untouched.

/** ui-state keys + defaults for the Settings → Notes section. The palette,
 * the settings panel, and the host's capture drain all read these, so they
 * live with the shared helpers. */
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

/** Substitute the fixed template placeholders in one pass. ONLY `{{date}}` and
 * `{{title}}` are replaced; a substituted value is never re-scanned (a title
 * that happens to contain `{{date}}` is left literal), and text with no
 * placeholders comes back byte-identical. */
export function applyTemplate(template: string, vars: { title: string; date: string }): string {
  return template.replaceAll(/\{\{(date|title)\}\}/g, (_match, key: string) =>
    key === "date" ? vars.date : vars.title,
  );
}
