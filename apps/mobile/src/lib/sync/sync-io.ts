// ---------------------------------------------------------------------------
// SyncIo adapter — the LOCAL vault access the @repo/domain `SyncEngine` reconciles
// against. The engine's port is synchronous (list/read/write/remove), and Expo's
// new File API exposes synchronous primitives (`bytesSync`/`write`/`list`), so
// this adapter is a thin, PURE mapper over a minimal `VaultFs` port.
//
// Splitting the recursion/path logic (here) from the Expo File/Directory wiring
// (expo-vault-fs.ts) keeps this module free of any `expo-*` import, so the walk +
// path logic is unit-testable on node against an in-memory `VaultFs` fake. Only
// real vault files are listed — no derived/app state lives under the vault root.
// ---------------------------------------------------------------------------

import type { SyncIo } from "@repo/domain/sync/engine";
import type { VaultPath } from "@repo/domain/sync/vault-file";

/** One immediate child of a vault directory. */
export type VaultEntry = {
  /** The entry's own name (last path segment), never a full path. */
  readonly name: string;
  readonly isDirectory: boolean;
};

/**
 * The minimal synchronous filesystem the SyncIo needs, rooted at the vault. All
 * paths are vault-relative POSIX (`"notes/todo.md"`); `""` is the vault root.
 * Implemented over Expo's File API in expo-vault-fs.ts; faked in tests.
 */
export type VaultFs = {
  /** Immediate children of a vault-relative dir (`""` = root). A missing dir → `[]`. */
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
