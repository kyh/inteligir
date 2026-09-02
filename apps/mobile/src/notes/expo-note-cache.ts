// laid out note-cache/<commit>/<sha256(path)>.json: a vault path runs to 1024 chars of unicode with
// `/`, and a POSIX filename stops near 255 bytes. only the composition root imports this; it loads
// native modules.

import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { z } from "zod";
import type { NoteCache } from "./note-cache";

const CACHE_DIR_NAME = "note-cache";

// refuses the newest rather than evicting: FIFO would cost a stat per row, and the directory dies
// at the next sweep anyway.
const MAX_ROWS_PER_COMMIT = 500;

const MAX_MEMOIZED_PATHS = 2_000;

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
  return new Directory(cacheRoot(), commit);
}

export function createExpoNoteCache(): NoteCache {
  const leafByPath = new Map<string, string>();

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
        return null;
      }
    },

    async set(note) {
      // the hash await first: it keeps the synchronous native calls below off the caller's stack.
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
