// Pure helpers for composing wiki-link bodies from picker selections —
// React-free so the completion semantics are pinned by unit tests.

/** The target text to write into `[[...]]` for a vault path: the bare
 * filename stem when it uniquely resolves back to the path (the short,
 * Obsidian-style form), else the full path (extension-less for `.md`), which
 * resolves exactly by construction. */
export function wikiBodyForPath(
  path: string,
  resolveWiki: (target: string) => string | null,
): string {
  const stem = path.replace(/\.md$/i, "");
  const base = stem.split("/").pop() ?? stem;
  if (resolveWiki(base) === path) return base;
  return stem;
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
