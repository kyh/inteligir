// The vault's convention folders, fixed paths rather than settings. Kept apart from the
// placeholder expansion, which loads the markdown and yaml parsers: the contract and every
// command-line verb read these names and must load neither.

import { isDocPath } from "../knowledge/doc-file";

export const TEMPLATES_FOLDER = "templates";
export const DAILY_TEMPLATE_PATH = `${TEMPLATES_FOLDER}/Daily.md`;
// where the day's note is written: a vault convention like the templates folder, not a setting
export const DAILY_NOTES_FOLDER = "notes/daily";
// where an attachment lands unless the vault chose another place; the phone, which never reads
// that choice, always lands its photos here
export const DEFAULT_ATTACHMENTS_FOLDER = "assets";

export const isTemplatePath = (path: string): boolean =>
  path.startsWith(`${TEMPLATES_FOLDER}/`) && isDocPath(path);
