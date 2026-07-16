// ---------------------------------------------------------------------------
// The Expo File-API backing for the engine's `BaseBlobStore` port — the
// content-addressed last-synced base BYTES the merge ladder diffs against, a
// flat directory of hash-named files under `${Paths.document}/sync-blobs/`.
// Mirrors expo-base-file.ts: the synchronous File API, a fresh File/Directory
// instance per call so `exists` reflects current state. Honors the port
// contract: `put` is an existence-checked no-op (mobile has no stat
// fingerprint, so every pass re-reads every file and calls `put` for each)
// and never throws — a dropped blob only degrades a merge to a conflict copy.
// ---------------------------------------------------------------------------

import { Directory, File, Paths } from "expo-file-system";

import type { BaseBlobStore } from "@repo/core/sync/blob-store";
import type { Hash } from "@repo/core/sync/vault-file";

/** The blob directory name under the app's document directory. */
const BLOBS_DIR = "sync-blobs";

/** Only content-addressed entries are ours — foreign files are never touched.
 * (No synchronous digest exists on Expo, so unlike the desktop store `get`
 * trusts a present blob rather than re-hashing it.) */
const BLOB_NAME_RE = /^[0-9a-f]{64}$/;

function fileFor(hash: Hash): File {
  return new File(Paths.document, BLOBS_DIR, hash);
}

/** A `BaseBlobStore` backed by Expo's synchronous File API. */
export function createExpoBlobStore(): BaseBlobStore {
  return {
    get: (hash) => {
      try {
        const file = fileFor(hash);
        return file.exists ? file.bytesSync() : null;
      } catch {
        return null; // unreadable blob → the ladder falls back to a conflict copy
      }
    },
    put: (hash, bytes) => {
      try {
        const file = fileFor(hash);
        if (file.exists) return; // content-addressed — already stored
        file.create({ intermediates: true, overwrite: true });
        file.write(bytes);
      } catch {
        // Capture is best-effort — a dropped blob degrades to a conflict copy.
      }
    },
    prune: (keep) => {
      const dir = new Directory(Paths.document, BLOBS_DIR);
      try {
        if (!dir.exists) return;
        for (const entry of dir.list()) {
          if (entry instanceof Directory) continue;
          if (!BLOB_NAME_RE.test(entry.name) || keep.has(entry.name)) continue;
          try {
            entry.delete();
          } catch {
            // A failed delete is retried on the next pass's prune.
          }
        }
      } catch {
        // Listing failed — nothing to prune this pass.
      }
    },
  };
}
