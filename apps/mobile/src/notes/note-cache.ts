// The note-body cache PORT, and its in-memory implementation — the same
// port/adapter split as the credential store: the pure shape here, the
// expo-file-system adapter beside it (expo-note-cache.ts), and only the
// composition root ever imports the adapter, so the node suite never loads a
// native module.
//
// Keyed by `(commit, path)`, which is what makes "cache forever" correct: the
// content at a commit is immutable, so a row never goes stale — a refresh
// that moves the tree's commit makes old rows UNREACHABLE, not wrong, and
// `sweep` reclaims them. A read with no tree commit is never cached: "head"
// moves, and a durable row keyed to it would serve yesterday's bytes as
// today's.
//
// A cache is BEST-EFFORT, and that is held at the ONE consumer rather than
// re-derived per implementation: `notes-store` swallows every refusal (a
// failed read is a miss, a failed write is a note fetched again next launch),
// so an implementation is free to throw and the discipline cannot be
// forgotten by the next adapter.
//
// The row BOUND is each implementation's own: the memory one evicts, the
// filesystem one refuses (ordering rows there costs a stat apiece). What both
// owe is only that they stay bounded.

export interface CachedNote {
  /** The tree commit the read was pinned to — half of the lookup key. */
  commit: string;
  path: string;
  content: string;
}

export interface NoteCache {
  get(commit: string, path: string): Promise<CachedNote | null>;
  set(note: CachedNote): Promise<void>;
  /** Drop every row whose commit is not `keepCommit`: a refresh moved the
   *  tree, and nothing can reach them again. A `set` still in flight for an
   *  older commit may land after the sweep — that row is equally unreachable,
   *  and the next sweep reclaims it. */
  sweep(keepCommit: string): Promise<void>;
  /** Forget everything — the credential changed, and at-rest rows must not
   *  outlive the pairing that fetched them. */
  clear(): Promise<void>;
}

/** Bounded FIFO: the oldest key is the least likely to be re-read at the
 *  current commit. */
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
