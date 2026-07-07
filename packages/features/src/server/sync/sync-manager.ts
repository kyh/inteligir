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
import { Type } from "@sinclair/typebox";

import { JsonStore, inteligirPath, type FsAdapter } from "../lib/json-store";
import { getVaultManager, type VaultManager } from "../vault/vault";
import { isRecord } from "@repo/features/ipc";
import type { VaultFile } from "@repo/core/sync/vault-file";
import type { VaultManifest } from "@repo/core/sync/manifest";
import type { SyncPort } from "@repo/core/sync/sync-port";
import { SyncEngine, type Clock, type Hasher, type SyncIo } from "@repo/core/sync/engine";
import type { BaseStore } from "@repo/core/sync/base-store";
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
    list: () => vault.list().map((entry) => entry.path),
    read: (path) => vault.readBytes(path),
    write: (path, content) => vault.writeBytes(path, content),
    remove: (path) => {
      vault.delete(path);
    },
  };
}

// ---------------------------------------------------------------------------
// Base-manifest store — the last-synced coordinator snapshot, per vault, under
// ~/.inteligir. The 3-way anchor `reconcile` diffs against; empty on first sync.
// ---------------------------------------------------------------------------

const BASE_VERSION = 1;

const VaultFileSchema = Type.Object(
  {
    path: Type.String(),
    contentHash: Type.String(),
    version: Type.Integer({ minimum: 0 }),
    size: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const BaseManifestSchema = Type.Object(
  {
    version: Type.Literal(BASE_VERSION),
    vaultId: Type.String(),
    generation: Type.Integer({ minimum: 0 }),
    files: Type.Array(VaultFileSchema),
  },
  { additionalProperties: false },
);

function emptyManifest(vaultId: string): VaultManifest {
  return { vaultId, generation: 0, files: [] };
}

/** Per-vault base file, keyed by a short hash of the vaultId so switching the
 * synced vault never clobbers another's anchor (vaultIds may contain `/`). */
function baseStorePath(vaultId: string): string {
  const key = crypto.createHash("sha256").update(vaultId).digest("hex").slice(0, 16);
  return inteligirPath(`sync-base-${key}.json`);
}

/**
 * A `BaseStore` backed by a versioned per-vault `JsonStore` under ~/.inteligir.
 * A base is a pure cache of the last sync, so a legacy/corrupt/foreign file just
 * means "re-sync from empty", never data loss.
 */
export function createJsonBaseStore(
  vaultId: string,
  opts: { fs?: FsAdapter | undefined; path?: string | undefined } = {},
): BaseStore {
  const store = new JsonStore<VaultManifest>(
    opts.path ?? baseStorePath(vaultId),
    BaseManifestSchema,
    emptyManifest(vaultId),
    {
      fs: opts.fs,
      versioning: {
        current: BASE_VERSION,
        // No unversioned era — the base file is new. A base is a pure cache of
        // the last sync, so a legacy/corrupt file just means "re-sync from
        // empty", never data loss.
        fromLegacy: () => {
          throw new Error("sync-base has no version field");
        },
      },
      decode: (raw) => {
        if (!isBaseFile(raw)) throw new Error("sync-base shape rejected");
        return { vaultId: raw.vaultId, generation: raw.generation, files: raw.files };
      },
      encode: (value) => ({
        version: BASE_VERSION,
        vaultId: value.vaultId,
        generation: value.generation,
        files: value.files,
      }),
    },
  );
  return {
    load: () => {
      const stored = store.read();
      // The per-vault filename already isolates anchors, but guard the id too so
      // a reused file can never seed a foreign vault's base (→ start from empty).
      return stored.vaultId === vaultId ? stored : emptyManifest(vaultId);
    },
    save: (manifest) => {
      store.write(manifest);
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

// ---- module internals -----------------------------------------------------

type BaseFile = {
  version: number;
  vaultId: string;
  generation: number;
  files: readonly VaultFile[];
};

// Structural guard for the decoded base file (the schema Value.Check already ran
// in JsonStore.read; this narrows the `unknown` decode input without a cast).
function isBaseFile(raw: unknown): raw is BaseFile {
  return (
    isRecord(raw) &&
    raw["version"] === BASE_VERSION &&
    typeof raw["vaultId"] === "string" &&
    typeof raw["generation"] === "number" &&
    Array.isArray(raw["files"])
  );
}
