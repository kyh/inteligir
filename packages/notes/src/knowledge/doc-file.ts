// Single source of truth for "what is an editable markdown doc" — shared by
// the vault's entry classification, the knowledge index, and every client
// surface that shows a doc by name, so they can never drift.

import { basenamePath, extnamePath } from "./vault-path";

const DOC_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt"]);

/** The extension a newly created doc gets when its name carries none. */
export const DEFAULT_DOC_EXTENSION = ".md";

/** True when the path names an editable markdown/text doc (by extension). */
export function isDocPath(path: string): boolean {
  return DOC_EXTENSIONS.has(extnamePath(path).toLowerCase());
}

/** The doc extension `path` carries, spelled as it is on disk (`".md"`,
 * `".Markdown"`), or `""` when the path names no doc. */
export function docExtension(path: string): string {
  return isDocPath(path) ? extnamePath(path) : "";
}

/** The doc's name without the extension — what a title surface edits. A file
 * that is not a doc carries no extension to hide, so its whole basename is
 * the stem. */
export function docStem(path: string): string {
  const name = basenamePath(path);
  return name.slice(0, name.length - docExtension(path).length);
}
