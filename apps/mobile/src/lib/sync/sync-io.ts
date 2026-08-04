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

import { isExcludedFileName, isPrunedName } from "@repo/notes/sync/crawl-exclusions";
import type { SyncIo } from "@repo/notes/sync/engine";
import type { VaultPath } from "@repo/notes/sync/vault-file";

/** One immediate child of a vault directory. */
export type VaultEntry = {
  /** The entry's own name (last path segment), never a full path. */
  readonly name: string;
  readonly isDirectory: boolean;
};

/** The cheap stat of a vault file — the raw fields the sync fingerprint is
 * built from. `lastModified` is milliseconds since epoch. */
type VaultStat = {
  readonly lastModified: number;
  readonly size: number;
};

/**
 * Thrown by a `VaultFs` when the vault ROOT itself cannot be read. To a
 * directory walk a missing root is indistinguishable from "every file was
 * deleted", and the sync engine's 3-way reconcile would push that as a
 * vault-wide deletion to the coordinator and every peer — so the fs REFUSES
 * instead of returning `[]`, and the pass fails cleanly. The UI listing
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
 * Thrown by a `VaultFs` when a SUB-directory cannot be read. Same hazard as a
 * missing root, one level down and harder to see: siblings still list, so the
 * overall result is non-empty and the empty-vault guard never fires — the
 * vanished subtree reconciles as a pile of deletions and propagates to every
 * peer. Desktop refuses the same way (its crawl marks `complete:false` and
 * `listAllPaths()` throws); returning `[]` here deletes silently.
 *
 * A pass that cannot see the whole vault must not run at all.
 */
export class VaultListingIncompleteError extends Error {
  constructor(relDir: string) {
    super(
      `vault subtree "${relDir}" could not be listed — refusing to sync a partial ` +
        "listing; the missing files would sync as deletions",
    );
    this.name = "VaultListingIncompleteError";
  }
}

/**
 * The minimal synchronous filesystem the SyncIo needs, rooted at the vault. All
 * paths are vault-relative POSIX (`"notes/todo.md"`); `""` is the vault root.
 * Implemented over Expo's File API in expo-vault-fs.ts; faked in tests.
 */
export type VaultFs = {
  /** Immediate children of a vault-relative dir. An unreadable directory must
   * THROW, never return `[]`: `VaultRootMissingError` for the root, and
   * `VaultListingIncompleteError` for a sub-dir. Either way an empty or partial
   * listing would reconcile as deletions. */
  listDir(relDir: string): readonly VaultEntry[];
  /** Whether a file is on disk at all, whatever its bytes. Distinct from a
   * successful `readBytes`: an unreadable file still exists, and treating the
   * two the same lets a caller overwrite content it never saw. */
  exists(path: VaultPath): boolean;
  /** Raw bytes of a vault file. */
  readBytes(path: VaultPath): Uint8Array;
  /** Write raw bytes, creating any missing parent directories. */
  writeBytes(path: VaultPath, bytes: Uint8Array): void;
  /** Remove a vault file (idempotent — absent is fine). */
  remove(path: VaultPath): void;
  /** Cheap stat of a vault file, or `null` when it is missing or unreadable.
   * MUST return `null` (never a guessed/stale value) on ANY doubt: the stat
   * feeds the sync engine's hash cache, where a wrong-but-stable value would
   * license reusing a stale content hash — a silently missed edit. */
  stat(path: VaultPath): VaultStat | null;
};

/** Depth-first collect every FILE under `relDir` as sorted vault-relative paths.
 *
 * The exclusions come from @repo/notes so this walk and the desktop crawl
 * answer from ONE set: a name only one of them lists is pushed by that platform
 * and then read by the other as "in base, absent from local" — a permanent
 * deletion from R2 and from every peer. */
function walk(fs: VaultFs, relDir: string): VaultPath[] {
  const out: VaultPath[] = [];
  for (const entry of fs.listDir(relDir)) {
    if (entry.isDirectory ? isPrunedName(entry.name) : isExcludedFileName(entry.name)) continue;
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
    // Change-detection key for the engine's stat-keyed hash cache:
    // `${lastModified}:${size}`. A content change moves at least one of the two
    // in every ordinary case — size catches length changes, lastModified
    // catches same-length edits. The theoretical residue (same size + same
    // ms-granularity mtime + different bytes) is the SAME gap the desktop's
    // mtime-based fingerprint accepts (mobile just lacks its `ino` third
    // field), and the engine invalidates its own writes explicitly, so a
    // matching key only ever licenses reuse across EXTERNAL quiet periods.
    // Any stat failure yields null — the engine then re-hashes: fail toward
    // slow-but-correct, never toward fast-but-stale.
    fingerprint: (path) => {
      try {
        const stat = fs.stat(path);
        return stat === null ? null : `${stat.lastModified}:${stat.size}`;
      } catch {
        return null;
      }
    },
  };
}
