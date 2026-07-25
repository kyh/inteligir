// ---------------------------------------------------------------------------
// The Expo File-API backing for the SyncIo's `VaultFs` port. Roots the vault at
// `${Paths.document}/vault/` and uses the NEW synchronous File API
// (`bytesSync`/`write`/`list`/`exists`/`lastModified`/`size`) so it satisfies
// the engine's synchronous `SyncIo`. A fresh File/Directory instance is created
// per call so `exists` (and every stat) always reflects current filesystem
// state.
// ---------------------------------------------------------------------------

import { Directory, File, Paths } from "expo-file-system";

import { isValidVaultPath, type VaultPath } from "@repo/notes/sync/vault-file";
import { VaultListingIncompleteError, VaultRootMissingError, type VaultFs } from "./sync-io";

/** The vault directory name under the app's document directory. */
const VAULT_DIR = "vault";

// Confine every path this sink resolves to the vault root. Sync-supplied paths
// are already validated at the wire boundary (parseVaultFile), but Expo's File
// resolves `..` segments, so this sink must never trust a path it's handed — a
// `..`/absolute/escape path is a defect (or a hostile coordinator manifest), so
// throw rather than write outside the vault. The empty string ("" = the root
// dir itself) is legitimate for dirFor and is allowed through.
function assertConfined(rel: string): void {
  if (rel !== "" && !isValidVaultPath(rel)) {
    throw new Error(`refusing a vault path that escapes the root: ${JSON.stringify(rel)}`);
  }
}

function segments(rel: string): string[] {
  return rel === "" ? [] : rel.split("/");
}

function fileFor(path: VaultPath): File {
  assertConfined(path);
  return new File(Paths.document, VAULT_DIR, ...segments(path));
}

function dirFor(relDir: string): Directory {
  assertConfined(relDir);
  return new Directory(Paths.document, VAULT_DIR, ...segments(relDir));
}

/** A `VaultFs` backed by Expo's synchronous File API. */
export function createExpoVaultFs(): VaultFs {
  // Ensure the vault root exists up front (best-effort — mirrors the desktop's
  // ensureRootDir): a fresh install must find a root to walk, because
  // listDir("") below treats a MISSING root as an error, never as an empty
  // vault — an empty listing over a lost root would sync as a vault-wide
  // deletion (#429).
  try {
    const root = dirFor("");
    if (!root.exists) root.create({ intermediates: true });
  } catch (err) {
    console.warn("[sync] could not create vault root:", err);
  }
  return {
    listDir: (relDir) => {
      const dir = dirFor(relDir);
      if (!dir.exists) {
        if (relDir === "") throw new VaultRootMissingError();
        // NOT `[]` (#466): siblings would still list, so the overall result
        // stays non-empty, the empty-vault guard never fires, and this
        // subtree's files reconcile as deletions on every peer. Desktop has
        // always refused a partial crawl; mobile now matches.
        throw new VaultListingIncompleteError(relDir);
      }
      return dir.list().map((entry) => ({
        name: entry.name,
        isDirectory: entry instanceof Directory,
      }));
    },
    readBytes: (path) => fileFor(path).bytesSync(),
    writeBytes: (path, bytes) => {
      const file = fileFor(path);
      // `intermediates` creates any missing parent directories; `overwrite`
      // makes the create idempotent when the file already exists. Then write.
      file.create({ intermediates: true, overwrite: true });
      file.write(bytes);
    },
    remove: (path) => {
      const file = fileFor(path);
      if (file.exists) file.delete();
    },
    stat: (path) => {
      try {
        const file = fileFor(path);
        // Both are SYNCHRONOUS native properties (like `bytesSync` above).
        // `lastModified` is null when the file is missing or unreadable;
        // `size` degrades to 0 in those cases (indistinguishable from an
        // empty file), so gate on lastModified FIRST — an unstat-able file
        // must yield null, never a guessed fingerprint (VaultFs contract).
        const lastModified = file.lastModified;
        return lastModified === null ? null : { lastModified, size: file.size };
      } catch {
        return null;
      }
    },
  };
}
