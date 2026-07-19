// ---------------------------------------------------------------------------
// The Expo File-API backing for the SyncIo's `VaultFs` port. Roots the vault at
// `${Paths.document}/vault/` and uses the NEW synchronous File API
// (`bytesSync`/`write`/`list`/`exists`) so it satisfies the engine's synchronous
// `SyncIo`. A fresh File/Directory instance is created per call so `exists`
// always reflects current filesystem state.
// ---------------------------------------------------------------------------

import { Directory, File, Paths } from "expo-file-system";

import type { VaultPath } from "@repo/domain/sync/vault-file";
import type { VaultFs } from "./sync-io";

/** The vault directory name under the app's document directory. */
const VAULT_DIR = "vault";

function segments(rel: string): string[] {
  return rel === "" ? [] : rel.split("/");
}

function fileFor(path: VaultPath): File {
  return new File(Paths.document, VAULT_DIR, ...segments(path));
}

function dirFor(relDir: string): Directory {
  return new Directory(Paths.document, VAULT_DIR, ...segments(relDir));
}

/** A `VaultFs` backed by Expo's synchronous File API. */
export function createExpoVaultFs(): VaultFs {
  return {
    listDir: (relDir) => {
      const dir = dirFor(relDir);
      if (!dir.exists) return [];
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
  };
}
