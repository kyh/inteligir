// oxlint-disable eslint/require-await -- the in-memory cache answers the async NoteCache
// port synchronously; `async` is the contract it implements
// keyed by (commit, path): content at a commit is immutable, so a row never goes stale, only
// unreachable. best-effort is held in notes-store, which swallows every refusal, so an
// implementation may throw.

export interface CachedNote {
  commit: string;
  path: string;
  content: string;
}

export interface NoteCache {
  get: (commit: string, path: string) => Promise<CachedNote | null>;
  set: (note: CachedNote) => Promise<void>;
  sweep: (keepCommit: string) => Promise<void>;
  clear: () => Promise<void>;
}

export const createMemoryNoteCache = (maxEntries: number): NoteCache => {
  const rows = new Map<string, CachedNote>();
  return {
    async clear() {
      rows.clear();
    },
    async get(commit, path) {
      return rows.get(`${commit}:${path}`) ?? null;
    },
    async set(note) {
      rows.set(`${note.commit}:${note.path}`, note);
      while (rows.size > maxEntries) {
        const oldest = rows.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        rows.delete(oldest);
      }
    },
    async sweep(keepCommit) {
      for (const [key, row] of rows) {
        if (row.commit !== keepCommit) {
          rows.delete(key);
        }
      }
    },
  };
};
