// ---------------------------------------------------------------------------
// SyncIo adapter — the LOCAL vault access the @repo/notes `SyncEngine` reconciles
// against. The engine's port is synchronous (list/read/write/remove), and Expo's
// new File API exposes synchronous primitives (`bytesSync`/`write`/`list`), so
// this adapter is a thin, PURE mapper over a minimal `VaultFs` port.
//
// Splitting the recursion/path logic (here) from the Expo File/Directory wiring
// (expo-vault-fs.ts) keeps this module free of any `expo-*` import, so the walk +
// path logic is unit-testable on node against an in-memory `VaultFs` fake. Only
// real vault files are listed — no derived/app state lives under the vault root.
// ---------------------------------------------------------------------------

import type { SyncIo } from "@repo/notes/sync/engine";
import type { VaultPath } from "@repo/notes/sync/vault-file";

/** One immediate child of a vault directory. */
export type VaultEntry = {
  /** The entry's own name (last path segment), never a full path. */
  readonly name: string;
  readonly isDirectory: boolean;
};

/**
 * Thrown by a `VaultFs` when the vault ROOT itself cannot be read. To a
 * directory walk a missing root is indistinguishable from "every file was
 * deleted", and the sync engine's 3-way reconcile would push that as a
 * vault-wide deletion to the coordinator and every peer — so the fs REFUSES
 * instead of returning `[]`, and the pass fails cleanly (#429). The UI listing
 * (vault-access) catches exactly this error and stays lenient.
 */
export class VaultRootMissingError extends Error {
  constructor() {
    super(
      "vault root directory is missing — refusing to treat it as an empty vault; " +
        "an empty listing would sync as a mass deletion",
    );
    this.name = "VaultRootMissingError";
  }
}

/**
 * The minimal synchronous filesystem the SyncIo needs, rooted at the vault. All
 * paths are vault-relative POSIX (`"notes/todo.md"`); `""` is the vault root.
 * Implemented over Expo's File API in expo-vault-fs.ts; faked in tests.
 */
export type VaultFs = {
  /** Immediate children of a vault-relative dir. A missing SUB-dir → `[]`
   * (vanished mid-walk — the next pass settles it); a missing ROOT (`""`)
   * must throw `VaultRootMissingError` instead — an empty result there would
   * read as a mass deletion (#429). */
  listDir(relDir: string): readonly VaultEntry[];
  /** Raw bytes of a vault file. */
  readBytes(path: VaultPath): Uint8Array;
  /** Write raw bytes, creating any missing parent directories. */
  writeBytes(path: VaultPath, bytes: Uint8Array): void;
  /** Remove a vault file (idempotent — absent is fine). */
  remove(path: VaultPath): void;
};

/** Depth-first collect every FILE under `relDir` as sorted vault-relative paths. */
function walk(fs: VaultFs, relDir: string): VaultPath[] {
  const out: VaultPath[] = [];
  for (const entry of fs.listDir(relDir)) {
    const child = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    if (entry.isDirectory) out.push(...walk(fs, child));
    else out.push(child);
  }
  return out;
}

/** Adapt a `VaultFs` to the engine's `SyncIo` port. */
export function createSyncIo(fs: VaultFs): SyncIo {
  return {
    list: () => walk(fs, "").toSorted(),
    read: (path) => fs.readBytes(path),
    write: (path, content) => {
      fs.writeBytes(path, content);
    },
    remove: (path) => {
      fs.remove(path);
    },
  };
}
