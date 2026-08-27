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
// Writes are synchronous native calls (`File.write`); they run inside `set`,
// which the store calls fire-and-forget AFTER answering the read, so a save
// never sits in front of a render. The per-commit row cap bounds disk use the
// way the memory cache's FIFO bounds heap — past it, a note simply fetches
// again next launch.

import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { z } from "zod";
import type { CachedNote, NoteCache } from "./note-cache";

const CACHE_DIR_NAME = "note-cache";
const MAX_ROWS_PER_COMMIT = 500;

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

function commitDir(commit: string): Directory {
  return new Directory(Paths.cache, CACHE_DIR_NAME, commit);
}

async function rowFile(commit: string, path: string): Promise<File> {
  const leaf = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, path);
  return new File(commitDir(commit), `${leaf}.json`);
}

export function createExpoNoteCache(): NoteCache {
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
        return null;
      }
    },

    async set(note: CachedNote) {
      try {
        const dir = commitDir(note.commit);
        dir.create({ intermediates: true, idempotent: true });
        if (dir.list().length >= MAX_ROWS_PER_COMMIT) return;
        const file = await rowFile(note.commit, note.path);
        file.write(JSON.stringify(note));
      } catch {
        // A failed write is a note fetched again next launch.
      }
    },

    sweep(keepCommit) {
      try {
        const root = cacheRoot();
        if (!root.exists) return Promise.resolve();
        for (const entry of root.list()) {
          if (entry.name !== keepCommit) entry.delete();
        }
      } catch {
        // A failed sweep leaves unreachable rows; the next one retries.
      }
      return Promise.resolve();
    },

    clear() {
      try {
        const root = cacheRoot();
        if (root.exists) root.delete();
      } catch {
        // A failed clear is retried by the next credential change.
      }
      return Promise.resolve();
    },
  };
}
