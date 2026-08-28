// Pure helpers for composing wiki-link bodies from picker selections —
// React-free so the completion semantics are pinned by unit tests.

import { docExtension, docStem } from "@repo/notes/knowledge/doc-file";

/** The target text to write into `[[...]]` for a vault path: the bare
 * filename stem when it uniquely resolves back to the path (the short,
 * Obsidian-style form), else the full path minus a doc extension, which
 * resolves exactly by construction. The extension the domain hides is the one
 * hidden here — a `.markdown` note must not get a different link body than the
 * same note reached any other way. */
export function wikiBodyForPath(
  path: string,
  resolveWiki: (target: string) => string | null,
): string {
  const base = docStem(path);
  if (resolveWiki(base) === path) return base;
  return path.slice(0, path.length - docExtension(path).length);
}

/** Compose a full wiki body from a target plus the anchor/alias the user
 * already typed into the picker query (`target#anchor|alias`). */
export function composeWikiBody(
  target: string,
  parts: { anchor?: string | undefined; alias?: string | undefined },
): string {
  const anchor = parts.anchor !== undefined && parts.anchor !== "" ? `#${parts.anchor}` : "";
  const alias = parts.alias !== undefined && parts.alias !== "" ? `|${parts.alias}` : "";
  return `${target}${anchor}${alias}`;
}
