// Obsidian-style wiki-links: [[Note Name]] or [[Note Name|alias]]. Plain text in
// the markdown (so they round-trip through the editor untouched); this module is
// the single source of truth for parsing them and resolving a target to a vault
// path, used both by the editor (clickable links) and main (the backlink graph).

const WIKI_LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/** An outgoing wiki-link resolved against the vault. `path` is null for a
 * broken link (no matching file). */
export type ResolvedWikiLink = { target: string; alias: string | null; path: string | null };

/** The link relationships for one note: its outgoing links + the notes that
 * link back to it. */
export type NoteLinks = { outgoing: ResolvedWikiLink[]; backlinks: string[] };

export type WikiLink = {
  /** The raw `[[…]]` text. */
  raw: string;
  /** The link target (before any `|alias`), trimmed. */
  target: string;
  /** The display alias after `|`, or null. */
  alias: string | null;
  /** Character offset of the `[[` in the source. */
  start: number;
  /** Character offset just past the `]]`. */
  end: number;
};

/** Extract every wiki-link from markdown text, in order. */
export function parseWikiLinks(text: string): WikiLink[] {
  const links: WikiLink[] = [];
  for (const m of text.matchAll(WIKI_LINK)) {
    const target = (m[1] ?? "").trim();
    if (target === "") continue;
    links.push({
      raw: m[0],
      target,
      alias: m[2] !== undefined ? m[2].trim() : null,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return links;
}

function stripMdExt(path: string): string {
  return path.replace(/\.(md|markdown)$/i, "");
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * Resolve a wiki-link target to a vault-relative file path, or null if no file
 * matches (a broken link). A target containing "/" resolves by path; a bare name
 * resolves by basename (case-insensitive), the way Obsidian does. Deterministic:
 * ties break on the first path in sorted order.
 */
export function resolveWikiTarget(target: string, paths: readonly string[]): string | null {
  const cleaned = stripMdExt(target.trim().replace(/^\.\//, ""));
  const hasSlash = cleaned.includes("/");
  const wanted = cleaned.toLowerCase();
  const sorted = paths.toSorted((a, b) => a.localeCompare(b));

  for (const path of sorted) {
    const candidate = hasSlash ? stripMdExt(path) : stripMdExt(basename(path));
    if (candidate.toLowerCase() === wanted) return path;
  }
  return null;
}
