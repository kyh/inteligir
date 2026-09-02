export type TagCount = { tag: string; count: number };

type TagEntry = {
  display: string;
  /** path → the display case that doc wrote, so a scoped view can render a surviving note's spelling */
  paths: Map<string, string>;
};

export class TagIndex {
  private readonly tags = new Map<string, TagEntry>();
  private readonly docTags = new Map<string, string[]>();

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
        entry = { display, paths: new Map() };
        this.tags.set(key, entry);
      }
      entry.paths.set(path, display);
    }
    if (keys.length > 0) this.docTags.set(path, keys);
  }

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

  all(): TagCount[] {
    const counts: TagCount[] = [];
    for (const entry of this.tags.values()) {
      counts.push({ tag: entry.display, count: entry.paths.size });
    }
    return counts.toSorted(
      (a, b) => b.count - a.count || (a.tag.toLowerCase() < b.tag.toLowerCase() ? -1 : 1),
    );
  }

  tagsOf(path: string): string[] {
    const keys = this.docTags.get(path) ?? [];
    return keys.map((key) => this.tags.get(key)?.display ?? key);
  }

  notesWithTag(tag: string): string[] {
    const entry = this.tags.get(tag.trim().toLowerCase());
    return entry ? [...entry.paths.keys()].toSorted() : [];
  }
}
