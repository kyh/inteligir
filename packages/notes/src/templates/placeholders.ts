// Expanded on the raw bytes before any parser runs: `{{` is the formula grammar, and a
// placeholder is exactly one of three bare spellings, so a pill (`{{a|b}}`) is never touched.
// The set is closed; a fourth spelling is a fourth thing the pill grammar must never mean.

import { formatIsoDate, formatIsoTime } from "../iso-date";
import { isDocPath } from "../knowledge/doc-file";

export const TEMPLATES_FOLDER = "templates";
export const DAILY_TEMPLATE_PATH = `${TEMPLATES_FOLDER}/Daily.md`;
// where the day's note is written: a vault convention like the templates folder, not a setting
export const DAILY_NOTES_FOLDER = "notes/daily";

export const isTemplatePath = (path: string): boolean =>
  path.startsWith(`${TEMPLATES_FOLDER}/`) && isDocPath(path);

interface TemplateContext {
  now: Date;
  title: string;
}

const PLACEHOLDER_RE = /\{\{(?<name>date|time|title)\}\}/gu;

export const expandTemplate = (markdown: string, context: TemplateContext): string =>
  markdown.replace(PLACEHOLDER_RE, (_match, name: string) => {
    if (name === "date") {
      return formatIsoDate(context.now);
    }
    if (name === "time") {
      return formatIsoTime(context.now);
    }
    return context.title;
  });
