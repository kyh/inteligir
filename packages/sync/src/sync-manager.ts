// ---------------------------------------------------------------------------
// Desktop sync adapters — the node platform bindings for @repo/notes's
// SyncEngine. The vault-sync ENGINE (queue serialization, reconcile+execute,
// base advancement, conflict copies) is platform-neutral and lives in
// `@repo/notes/sync/engine`; the future Expo/React-Native app shares that same
// implementation. This module supplies the four node-specific ports the engine
// needs and wires them together:
//   - createNodeHasher    — node:crypto sha-256 (wrapped async)
//   - createVaultSyncIo   — a live VaultManager as the engine's SyncIo
//   - createJsonBaseStore — the last-synced base manifest under ~/.inteligir
//   - createNodeBlobStore — content-addressed base BYTES for the merge ladder
//   - nodeStamp           — a filesystem-safe ISO timestamp for conflict copies
//
// OFF BY DEFAULT at runtime: create-host starts the SyncCoordinator at boot,
// but it constructs + runs the engine only when sync is enabled in config AND
// a bearer token is present (see boot/create-host.ts and sync-coordinator.ts).
// Only VAULT FILES are synced; the knowledge index and all AI/editor state live
// under ~/.inteligir (outside the vault) and are never listed here, so derived
// state can't leak into the protocol.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  SYNC_BLOBS_DIR_PREFIX,
  inteligirPath,
  realFs,
  shortPathKey,
  type FsAdapter,
} from "@repo/storage/json-store";
import type { VaultManager } from "@repo/vault/vault";
import type { SyncPort } from "@repo/notes/sync/sync-port";
import {
  SyncEngine,
  type Clock,
  type Hasher,
  type SyncIo,
  type SyncOutcome,
} from "@repo/notes/sync/engine";
import {
  createJsonFileBaseStore,
  type BaseStore,
  type JsonFile,
} from "@repo/notes/sync/base-store";
import { isBlobFileName, type BaseBlobStore } from "@repo/notes/sync/blob-store";
import type { Hash } from "@repo/notes/sync/vault-file";
import { fsSafeStamp } from "@repo/notes/sync/reconcile";

// ---------------------------------------------------------------------------
// Hasher — node's synchronous sha-256, wrapped in the engine's async contract
// (RN/web only expose an async digest).
// ---------------------------------------------------------------------------

export function createNodeHasher(): Hasher {
  return (bytes) => Promise.resolve(crypto.createHash("sha256").update(bytes).digest("hex"));
}

// ---------------------------------------------------------------------------
// Clock — a filesystem-safe conflict-copy timestamp (no `:`/`.` — Windows/exFAT
// reject `:`). @repo/notes stays clock-free; the desktop supplies this.
// ---------------------------------------------------------------------------

export function nodeStamp(now: () => Date = () => new Date()): Clock {
  return () => fsSafeStamp(now());
}

// ---------------------------------------------------------------------------
// SyncIo — the live VaultManager adapted to the engine's port (like
// DelegationManager's readVault/writeVault) so the engine never imports
// node/electron directly and is unit-testable against a temp-dir vault.
// ---------------------------------------------------------------------------

/** The inode a vault-relative path currently resolves to, or null when it can't
 * be stat'd. A zero inode counts as UNKNOWN: Windows filesystems that expose no
 * file index report 0 for every file, and an all-zero identity would make every
 * path look like every other one. */
function inodeOf(root: string, rel: string): number | null {
  try {
    const ino = fs.statSync(path.join(root, rel)).ino;
    return ino === 0 ? null : ino;
  } catch {
    return null;
  }
}

/** Adapt the live `VaultManager` to the engine's `SyncIo` port. */
export function createVaultSyncIo(vault: VaultManager): SyncIo {
  // Inode → the vault path this port wrote it at. Two vault paths that differ
  // only in case are ONE file on APFS/NTFS, so a delete can resolve to a file a
  // pull just landed and destroy it — an absence the next pass would report as
  // a deletion to every device. The engine's phase order is what prevents that;
  // this is the second lock. Entries outlive the files that filled them (an
  // inode gets reused), so a hit is only believed after re-stat'ing the path it
  // names: refuse on a LIVE alias, never on a remembered one.
  const writtenByInode = new Map<number, string>();
  return {
    list: () => vault.listAllPaths(),
    // The crawl reports what it could not read as a file; the ENGINE decides
    // whether that can delete anything, because only it holds the base anchor.
    unaccounted: () => vault.unaccountedPaths(),
    root: () => vault.getRoot(),
    read: (path) => vault.readBytes(path),
    write: (path, content) => {
      vault.writeBytes(path, content);
      const ino = inodeOf(vault.getRoot(), path);
      if (ino !== null) writtenByInode.set(ino, path);
    },
    // Deliberately the PERMANENT delete, not trash(): a sync-applied remote
    // delete was user-initiated (and OS-trashed) on the originating device,
    // and this port is synchronous by the engine's contract. Conflicting
    // local edits are already preserved as sibling copies by reconcile.
    remove: (path) => {
      const root = vault.getRoot();
      const target = inodeOf(root, path);
      const alias = target === null ? undefined : writtenByInode.get(target);
      if (alias !== undefined && alias !== path && inodeOf(root, alias) === target) {
        throw new Error(
          `sync: refusing to delete ${path} — this filesystem resolves it to ${alias}, ` +
            "which this sync wrote; deleting it would report the file as gone to every device",
        );
      }
      vault.delete(path);
    },
    // Stat-keyed change detection so a pass skips re-hashing unchanged files.
    // Snapshot-served when the vault's walk cache is fresh (≤1s; own writes
    // always invalidate), so a pass adds no second stat sweep — an external
    // write racing that window is caught on the next pass (engine self-heals).
    fingerprint: (path) => vault.statFingerprint(path),
  };
}

// ---------------------------------------------------------------------------
// Base-manifest store — the last-synced coordinator snapshot, per vault, under
// ~/.inteligir. The 3-way anchor `reconcile` diffs against; empty on first sync.
// A thin fs-backed `JsonFile` over core's `createJsonFileBaseStore` — the same
// factory mobile wraps its expo-file-system port around. A base is a PURE
// CACHE of the last sync, so a legacy/corrupt file just means "re-sync from
// empty", never data loss; no vaultId guard here, the engine already refuses a
// foreign-vault base (`engine.ts` `loadBase`: `stored.vaultId !== this.vaultId`
// → empty) so guarding twice would be redundant.
// ---------------------------------------------------------------------------

/** Per-vault base file, keyed by a short hash of the vaultId so switching the
 * synced vault never clobbers another's anchor (vaultIds may contain `/`). */
function baseStorePath(vaultId: string): string {
  return inteligirPath(`sync-base-${shortPathKey(vaultId)}.json`);
}

/** A synchronous `JsonFile` over a plain file path — `read` returns `null` on
 * any error (missing file, permission denied, …); `write` creates the parent
 * dir on demand. Delegates to an injected `FsAdapter` when the caller supplies
 * one (tests), otherwise to storage's shared `realFs` adapter — the same
 * atomic tmp-then-rename write + owner-only modes (0o600 file / 0o700 dir)
 * every ~/.inteligir JSON store gets. */
function nodeJsonFile(filePath: string, adapter: FsAdapter = realFs): JsonFile {
  return {
    read: () => adapter.read(filePath),
    write: (text) => {
      adapter.write(filePath, text);
    },
  };
}

/**
 * A `BaseStore` backed by a JSON file under ~/.inteligir. A base is a pure
 * cache of the last sync, so a legacy/corrupt/foreign file just means
 * "re-sync from empty", never data loss.
 */
export function createJsonBaseStore(
  vaultId: string,
  opts: { fs?: FsAdapter | undefined; path?: string | undefined } = {},
): BaseStore {
  return createJsonFileBaseStore(nodeJsonFile(opts.path ?? baseStorePath(vaultId), opts.fs));
}

// ---------------------------------------------------------------------------
// Base-blob store — content-addressed last-synced BYTES (markdown only) for
// the merge ladder's true 3-way base, per vault under ~/.inteligir. A flat
// directory of files named by their sha-256 contentHash — the same hashes the
// base manifest records. Like the base manifest it is a PURE CACHE: a missing
// or corrupt blob only downgrades a merge to a conflict copy.
// ---------------------------------------------------------------------------

/** Per-vault blob directory, keyed exactly like `baseStorePath`. */
function blobStoreDir(vaultId: string): string {
  return inteligirPath(`${SYNC_BLOBS_DIR_PREFIX}${shortPathKey(vaultId)}`);
}

/**
 * A `BaseBlobStore` over a flat directory of hash-named files. Honors the port
 * contract: `put` is an existence-checked no-op (content-addressed — same hash,
 * same bytes) and never throws; `get` re-hashes and returns `null` on a
 * mismatch so a torn write can never be merged as base bytes.
 */
export function createNodeBlobStore(
  vaultId: string,
  opts: { dir?: string | undefined } = {},
): BaseBlobStore {
  const dir = opts.dir ?? blobStoreDir(vaultId);
  const fileFor = (hash: Hash) => path.join(dir, hash);
  return {
    get: (hash) => {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(fs.readFileSync(fileFor(hash)));
      } catch {
        return null;
      }
      const digest = crypto.createHash("sha256").update(bytes).digest("hex");
      return digest === hash ? bytes : null;
    },
    put: (hash, bytes) => {
      const file = fileFor(hash);
      try {
        if (fs.existsSync(file)) return; // content-addressed — already stored
        // Last-synced note BYTES: the same owner-only boundary json-store's
        // writes hold, since this lands under ~/.inteligir alongside the
        // transcripts and snapshots the 0700/0600 rule exists for.
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, bytes, { mode: 0o600 });
      } catch {
        // Capture is best-effort — a dropped blob degrades to a conflict copy.
      }
    },
    prune: (keep) => {
      let entries: string[];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        return; // no directory yet — nothing to prune
      }
      for (const name of entries) {
        if (!isBlobFileName(name) || keep.has(name)) continue;
        try {
          fs.unlinkSync(path.join(dir, name));
        } catch {
          // A failed unlink is retried on the next pass's prune.
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// SyncManager — the desktop composition of the node ports into a core
// SyncEngine.
// ---------------------------------------------------------------------------

export type SyncManagerOptions = {
  /** The remote vault this client syncs. Scopes the SyncPort + the base store. */
  vaultId: string;
  /** The remote transport (an HttpSyncPort in production; a fake in tests). */
  port: SyncPort;
  /** Local vault access. REQUIRED — sync never reaches for the vault
   * singleton itself; the composition root adapts the live VaultManager via
   * createVaultSyncIo, tests pass an in-memory io. */
  vault: SyncIo;
  /** Override the base-manifest file path (tests). */
  basePath?: string;
  /** Override the base-blob directory (tests — keeps ~/.inteligir untouched). */
  blobsDir?: string;
  /** FsAdapter for the base store (tests). */
  fs?: FsAdapter;
  /** Clock for conflict-copy timestamps. Defaults to the wall clock. */
  now?: () => Date;
  /** Debounce window (ms) for `scheduleSync`. Default 300ms. */
  debounceMs?: number;
  /** Fires after EVERY completed pass (explicit or debounced) — see
   * `SyncEngineOptions.onOutcome`. The coordinator wires this to its
   * conflicts-accumulate path so a background pass surfaces immediately. */
  onOutcome?: (outcome: SyncOutcome) => void;
};

/**
 * Construct the desktop vault-sync engine: bind the node ports (hasher, vault
 * IO, base store, clock) and hand them to the platform-neutral `SyncEngine`.
 * The returned engine exposes start/stop/syncOnce/scheduleSync.
 */
export function createSyncManager(opts: SyncManagerOptions): SyncEngine {
  return new SyncEngine({
    vaultId: opts.vaultId,
    port: opts.port,
    io: opts.vault,
    base: createJsonBaseStore(opts.vaultId, { fs: opts.fs, path: opts.basePath }),
    blobs: createNodeBlobStore(opts.vaultId, { dir: opts.blobsDir }),
    hash: createNodeHasher(),
    stamp: nodeStamp(opts.now),
    debounceMs: opts.debounceMs,
    onOutcome: opts.onOutcome,
  });
}
