// ---------------------------------------------------------------------------
// Tag index: tag → the notes carrying it, fed by BOTH inline `#tag` tokens and
// the frontmatter `tags` property (the per-doc union is computed at extraction
// time — see tagsOf in link-extract.ts). Tags unify case-insensitively: the
// lowercased tag is the identity, and the display case of the FIRST occurrence
// among the currently-indexed docs is what surfaces.
//
// Incremental like SearchIndex: set/remove touch one doc's tag set. Derived and
// per-device — rebuilt locally, NEVER synced (the knowledge-index law).
// ---------------------------------------------------------------------------

/** A tag with the number of DISTINCT notes carrying it. `tag` is display case. */
export type TagCount = { tag: string; count: number };

type TagEntry = { display: string; paths: Set<string> };

export class TagIndex {
  /** lowercased tag → { display case, notes carrying it }. */
  private readonly tags = new Map<string, TagEntry>();
  /** path → the lowercased tag keys it contributed (the incremental diff basis). */
  private readonly docTags = new Map<string, string[]>();

  /** Index (or re-index) a doc's tags. Per-doc duplicates (`#Meta` + `#meta`,
   * or a frontmatter tag that also appears inline) collapse to one, keeping the
   * first-seen display case. */
  set(path: string, tags: readonly string[]): void {
    this.remove(path);
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const raw of tags) {
      const display = raw.trim();
      if (display === "") continue;
      const key = display.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
      let entry = this.tags.get(key);
      if (!entry) {
        entry = { display, paths: new Set() };
        this.tags.set(key, entry);
      }
      entry.paths.add(path);
    }
    if (keys.length > 0) this.docTags.set(path, keys);
  }

  /** Drop a doc's tag contributions. A tag no note carries anymore vanishes. */
  remove(path: string): void {
    const keys = this.docTags.get(path);
    if (!keys) return;
    for (const key of keys) {
      const entry = this.tags.get(key);
      if (!entry) continue;
      entry.paths.delete(path);
      if (entry.paths.size === 0) this.tags.delete(key);
    }
    this.docTags.delete(path);
  }

  clear(): void {
    this.tags.clear();
    this.docTags.clear();
  }

  /** Every tag with its note count, most-used first (ties broken alphabetically,
   * case-insensitively) — the palette's tag list ordering. */
  all(): TagCount[] {
    return [...this.tags.values()]
      .map((entry): TagCount => ({ tag: entry.display, count: entry.paths.size }))
      .toSorted(
        (a, b) => b.count - a.count || (a.tag.toLowerCase() < b.tag.toLowerCase() ? -1 : 1),
      );
  }

  /** The notes carrying `tag` (case-insensitive), by path. Empty when unknown. */
  notesWithTag(tag: string): string[] {
    const entry = this.tags.get(tag.trim().toLowerCase());
    return entry ? [...entry.paths].toSorted() : [];
  }
}
