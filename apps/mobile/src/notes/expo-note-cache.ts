// The durable NoteCache: note bodies on disk under the OS cache directory,
// laid out `note-cache/<commit>/<sha256(path)>.json`. Only the composition
// root imports this module — it touches native modules, and the node suite
// tests the store against the port's memory implementation instead.
//
// The path is HASHED into the leaf name because a vault path runs to 1024
// characters of arbitrary unicode with `/` separators, and a POSIX filename
// stops near 255 bytes. The commit is a directory level so `sweep` is one
// `delete()` per dead commit rather than a row-by-row scan. Each row stores
// its own `{commit, path, content}` and a read verifies both key halves — a
// torn write, a hash collision, or a foreign file all parse as a miss, never
// as content.
//
// The native calls here are SYNCHRONOUS, so two things are arranged rather
// than assumed. Everything heavy in `set` sits behind the path-hash await, so
// the store's fire-and-forget call returns to `readNote` before any of it
// runs. And neither the digest nor the row count is asked for twice: the
// digest is a pure function of the path, and the count only this module
// changes — so both are remembered instead of re-derived per write, which is
// what turns a session's reads from N directory enumerations into one.
//
// A failure is a MISS, never a throw — but the guarantee is the store's, not
// this module's: `notes-store` treats every call as best-effort, so only the
// catch that carries meaning (a read that answers "no row") lives here.

import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { z } from "zod";
import type { NoteCache } from "./note-cache";

const CACHE_DIR_NAME = "note-cache";

/**
 * Rows kept per commit. The disk bound REFUSES the newest rather than
 * evicting the oldest as the memory implementation does, and that divergence
 * is deliberate: FIFO here would need a stat per row to order them, while a
 * refused write costs one re-fetch of a note that stays reachable anyway —
 * and the whole directory dies at the next sweep regardless.
 */
const MAX_ROWS_PER_COMMIT = 500;

/** Bounds the digest memo. A vault larger than this simply re-hashes the
 *  paths that fall out — the memo is a saving, never a correctness claim. */
const MAX_MEMOIZED_PATHS = 2_000;

/** Parsed rather than trusted: this is bytes on disk, and a malformed row
 *  must read as a miss rather than as a note. */
const storedNoteSchema = z
  .object({
    commit: z.string().min(1),
    path: z.string().min(1),
    content: z.string(),
  })
  .strict();

function cacheRoot(): Directory {
  return new Directory(Paths.cache, CACHE_DIR_NAME);
}

/** Built FROM the root, so the cache's location on disk has one spelling —
 *  a second one would let `clear()` delete a tree that holds no rows. */
function commitDir(commit: string): Directory {
  return new Directory(cacheRoot(), commit);
}

export function createExpoNoteCache(): NoteCache {
  /** `sha256(path)` — the leaf name, a pure function of the path alone (the
   *  commit is a directory level), so it is computed once per path rather
   *  than on every get and the set that follows it. */
  const leafByPath = new Map<string, string>();

  /** How many rows the CURRENT commit's directory holds, counted once when
   *  the commit first appears and maintained here — the only writer. */
  let rows: { commit: string; count: number } | null = null;

  async function rowFile(commit: string, path: string): Promise<File> {
    let leaf = leafByPath.get(path);
    if (leaf === undefined) {
      leaf = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, path);
      leafByPath.set(path, leaf);
      while (leafByPath.size > MAX_MEMOIZED_PATHS) {
        const oldest = leafByPath.keys().next().value;
        if (oldest === undefined) break;
        leafByPath.delete(oldest);
      }
    }
    return new File(commitDir(commit), `${leaf}.json`);
  }

  return {
    async get(commit, path) {
      try {
        const file = await rowFile(commit, path);
        if (!file.exists) return null;
        const parsed = storedNoteSchema.safeParse(JSON.parse(await file.text()));
        if (!parsed.success) return null;
        const row = parsed.data;
        return row.commit === commit && row.path === path ? row : null;
      } catch {
        // Unreadable bytes are a miss; the note re-fetches.
        return null;
      }
    },

    async set(note) {
      // The hash FIRST: its await is what keeps every native call below off
      // the caller's synchronous stack.
      const file = await rowFile(note.commit, note.path);
      if (rows?.commit !== note.commit) {
        const dir = file.parentDirectory;
        dir.create({ intermediates: true, idempotent: true });
        rows = { commit: note.commit, count: dir.list().length };
      }
      if (rows.count >= MAX_ROWS_PER_COMMIT) return;
      const fresh = !file.exists;
      file.write(JSON.stringify(note));
      if (fresh) rows.count += 1;
    },

    async sweep(keepCommit) {
      const root = cacheRoot();
      if (!root.exists) return;
      for (const entry of root.list()) {
        if (entry.name !== keepCommit) entry.delete();
      }
      if (rows !== null && rows.commit !== keepCommit) rows = null;
    },

    async clear() {
      rows = null;
      const root = cacheRoot();
      if (root.exists) root.delete();
    },
  };
}
