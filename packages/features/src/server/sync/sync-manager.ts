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
//   - nodeStamp           — a filesystem-safe ISO timestamp for conflict copies
//
// OFF BY DEFAULT: this is an available capability, NOT wired into the live boot
// path. create-host does not construct or start it (see the seam comment there).
// Only VAULT FILES are synced; the knowledge index and all AI/editor state live
// under ~/.inteligir (outside the vault) and are never listed here, so derived
// state can't leak into the protocol.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { inteligirPath, type FsAdapter } from "../lib/json-store";
import { getVaultManager, type VaultManager } from "../vault/vault";
import type { SyncPort } from "@repo/core/sync/sync-port";
import { SyncEngine, type Clock, type Hasher, type SyncIo } from "@repo/core/sync/engine";
import { createJsonFileBaseStore, type BaseStore, type JsonFile } from "@repo/core/sync/base-store";
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
    remove: (path) => {
      vault.delete(path);
    },
    // Stat-keyed change detection so a pass skips re-hashing unchanged files.
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
  const key = crypto.createHash("sha256").update(vaultId).digest("hex").slice(0, 16);
  return inteligirPath(`sync-base-${key}.json`);
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
  /** FsAdapter for the base store (tests). */
  fs?: FsAdapter;
  /** Clock for conflict-copy timestamps. Defaults to the wall clock. */
  now?: () => Date;
  /** Debounce window (ms) for `scheduleSync`. Default 300ms. */
  debounceMs?: number;
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
    hash: createNodeHasher(),
    stamp: nodeStamp(opts.now),
    debounceMs: opts.debounceMs,
  });
}
