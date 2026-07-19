// ---------------------------------------------------------------------------
// Desktop sync adapters — the node platform bindings for @repo/core's
// SyncEngine. The vault-sync ENGINE (queue serialization, reconcile+execute,
// base advancement, conflict copies) is platform-neutral and lives in
// `@repo/core/sync/engine`; the future Expo/React-Native app shares that same
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
// a bearer token is present (see create-host.ts and sync-coordinator.ts).
// Only VAULT FILES are synced; the knowledge index and all AI/editor state live
// under ~/.inteligir (outside the vault) and are never listed here, so derived
// state can't leak into the protocol.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { inteligirPath, shortPathKey, type FsAdapter } from "../storage/json-store";
import { getVaultManager, type VaultManager } from "../vault/vault";
import type { SyncPort } from "@repo/core/sync/sync-port";
import {
  SyncEngine,
  type Clock,
  type Hasher,
  type SyncIo,
  type SyncOutcome,
} from "@repo/core/sync/engine";
import { createJsonFileBaseStore, type BaseStore, type JsonFile } from "@repo/core/sync/base-store";
import { isBlobFileName, type BaseBlobStore } from "@repo/core/sync/blob-store";
import type { Hash } from "@repo/core/sync/vault-file";
import { fsSafeStamp } from "@repo/core/sync/reconcile";

// ---------------------------------------------------------------------------
// Hasher — node's synchronous sha-256, wrapped in the engine's async contract
// (RN/web only expose an async digest).
// ---------------------------------------------------------------------------

export function createNodeHasher(): Hasher {
  return (bytes) => Promise.resolve(crypto.createHash("sha256").update(bytes).digest("hex"));
}

// ---------------------------------------------------------------------------
// Clock — a filesystem-safe conflict-copy timestamp (no `:`/`.` — Windows/exFAT
// reject `:`). @repo/core stays clock-free; the desktop supplies this.
// ---------------------------------------------------------------------------

export function nodeStamp(now: () => Date = () => new Date()): Clock {
  return () => fsSafeStamp(now());
}

// ---------------------------------------------------------------------------
// SyncIo — the live VaultManager adapted to the engine's port (like
// DelegationManager's readVault/writeVault) so the engine never imports
// node/electron directly and is unit-testable against a temp-dir vault.
// ---------------------------------------------------------------------------

/** Adapt the live `VaultManager` to the engine's `SyncIo` port. */
export function createVaultSyncIo(vault: VaultManager): SyncIo {
  return {
    list: () => vault.listAllPaths(),
    read: (path) => vault.readBytes(path),
    write: (path, content) => vault.writeBytes(path, content),
    // Deliberately the PERMANENT delete, not trash(): a sync-applied remote
    // delete was user-initiated (and OS-trashed) on the originating device,
    // and this port is synchronous by the engine's contract. Conflicting
    // local edits are already preserved as sibling copies by reconcile.
    remove: (path) => {
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
 * one (tests), otherwise talks to the real filesystem directly. */
function nodeJsonFile(filePath: string, adapter?: FsAdapter): JsonFile {
  if (adapter) {
    return {
      read: () => adapter.read(filePath),
      write: (text) => {
        adapter.write(filePath, text);
      },
    };
  }
  return {
    read: () => {
      try {
        return fs.readFileSync(filePath, "utf8");
      } catch {
        return null;
      }
    },
    write: (text) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, text, "utf8");
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
  return inteligirPath(`sync-blobs-${shortPathKey(vaultId)}`);
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
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, bytes);
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
  /** Local vault access. Defaults to the live VaultManager. */
  vault?: SyncIo;
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
 * The returned engine exposes start/stop/onVaultChanged/syncOnce/scheduleSync.
 */
export function createSyncManager(opts: SyncManagerOptions): SyncEngine {
  return new SyncEngine({
    vaultId: opts.vaultId,
    port: opts.port,
    io: opts.vault ?? createVaultSyncIo(getVaultManager()),
    base: createJsonBaseStore(opts.vaultId, { fs: opts.fs, path: opts.basePath }),
    blobs: createNodeBlobStore(opts.vaultId, { dir: opts.blobsDir }),
    hash: createNodeHasher(),
    stamp: nodeStamp(opts.now),
    debounceMs: opts.debounceMs,
    onOutcome: opts.onOutcome,
  });
}
