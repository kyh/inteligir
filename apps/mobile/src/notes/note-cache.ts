// keyed by (commit, path): content at a commit is immutable, so a row never goes stale, only
// unreachable. best-effort is held in notes-store, which swallows every refusal, so an
// implementation may throw.

export interface CachedNote {
  commit: string;
  path: string;
  content: string;
}

export interface NoteCache {
  get(commit: string, path: string): Promise<CachedNote | null>;
  set(note: CachedNote): Promise<void>;
  sweep(keepCommit: string): Promise<void>;
  clear(): Promise<void>;
}

export function createMemoryNoteCache(maxEntries: number): NoteCache {
  const rows = new Map<string, CachedNote>();
  return {
    get(commit, path) {
      return Promise.resolve(rows.get(`${commit}:${path}`) ?? null);
    },
    set(note) {
      rows.set(`${note.commit}:${note.path}`, note);
      while (rows.size > maxEntries) {
        const oldest = rows.keys().next().value;
        if (oldest === undefined) break;
        rows.delete(oldest);
      }
      return Promise.resolve();
    },
    sweep(keepCommit) {
      for (const [key, row] of rows) {
        if (row.commit !== keepCommit) rows.delete(key);
      }
      return Promise.resolve();
    },
    clear() {
      rows.clear();
      return Promise.resolve();
    },
  };
}
