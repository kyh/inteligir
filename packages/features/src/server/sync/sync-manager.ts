// ---------------------------------------------------------------------------
// SyncManager — the desktop's vault-sync engine. It reconciles the LOCAL vault
// against a remote `SyncPort` using @repo/core's pure 3-way merge and executes
// the resulting plan (push/pull/delete/conflict-copy), advancing a persisted
// last-synced BASE manifest as the anchor.
//
// Purity split (mirrors @repo/core's contract): `reconcile` decides WHAT to do
// from three manifests and reads no clock, does no I/O, hashes nothing. This
// manager supplies all of that — it hashes the local files (node crypto),
// executes ops over the SyncPort + local vault, and passes an ISO timestamp IN
// to name conflict copies. Only VAULT FILES are synced; the knowledge index and
// all AI/editor state live under ~/.inteligir (outside the vault) and are never
// listed here, so derived state can't leak into the protocol.
//
// OFF BY DEFAULT: this is an available capability, NOT wired into the live boot
// path. create-host does not construct or start it (see the seam comment there).
// Triggers (`start`/`onVaultChanged`/`scheduleSync`) exist for whoever enables
// it behind `HostOptions.syncEnabled`.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { Type } from "@sinclair/typebox";

import { JsonStore, inteligirPath, type FsAdapter } from "../lib/json-store";
import { getVaultManager, type VaultManager } from "../vault/vault";
import { isRecord } from "@repo/features/ipc";
import { ABSENT_VERSION, type VaultFile, type VaultPath } from "@repo/core/sync/vault-file";
import type { LocalFile, LocalManifest, VaultManifest } from "@repo/core/sync/manifest";
import type { SyncOp } from "@repo/core/sync/plan";
import type { SyncPort, Unsubscribe } from "@repo/core/sync/sync-port";
import { conflictCopyName, reconcile } from "@repo/core/sync/reconcile";

// ---------------------------------------------------------------------------
// VaultSyncIo — the narrow slice of the vault the sync engine touches. A port
// (like DelegationManager's readVault/writeVault) so the engine is unit-testable
// against a temp-dir VaultManager and never imports node/electron directly.
// ---------------------------------------------------------------------------

export type VaultSyncIo = {
  /** Vault-relative POSIX paths of every file (all kinds — assets sync too). */
  list(): readonly VaultPath[];
  /** Raw bytes of a vault file. */
  read(path: VaultPath): Uint8Array;
  /** Atomically write raw bytes to a vault file (creating parent dirs). */
  write(path: VaultPath, content: Uint8Array): void;
  /** Remove a vault file (idempotent — absent is fine). */
  remove(path: VaultPath): void;
};

/** Adapt the live `VaultManager` to the sync engine's port. */
export function createVaultSyncIo(vault: VaultManager): VaultSyncIo {
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

// ---------------------------------------------------------------------------
// SyncManager
// ---------------------------------------------------------------------------

export type SyncManagerOptions = {
  /** The remote vault this client syncs. Scopes the SyncPort + the base store. */
  vaultId: string;
  /** The remote transport (an HttpSyncPort in production; a fake in tests). */
  port: SyncPort;
  /** Local vault access. Defaults to the live VaultManager. */
  vault?: VaultSyncIo;
  /** Override the base-manifest file path (tests). */
  basePath?: string;
  /** FsAdapter for the base store (tests). */
  fs?: FsAdapter;
  /** Clock for conflict-copy timestamps. Defaults to the wall clock. */
  now?: () => Date;
  /** Debounce window (ms) for `scheduleSync`. Default 300ms. */
  debounceMs?: number;
};

/** What one `syncOnce` pass did (or why it failed). */
export type SyncOutcome =
  | {
      readonly status: "ok";
      readonly pushed: number;
      readonly pulled: number;
      readonly deleted: number;
      readonly conflicts: number;
    }
  | { readonly status: "error"; readonly message: string };

export class SyncManager {
  private readonly vaultId: string;
  private readonly port: SyncPort;
  private readonly vault: VaultSyncIo;
  private readonly baseStore: JsonStore<VaultManifest>;
  private readonly now: () => Date;
  private readonly debounceMs: number;

  // Serialize passes so two never overlap (a debounce fire during an in-flight
  // pass queues behind it rather than racing the same files).
  private queue: Promise<unknown> = Promise.resolve();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private remoteUnsub: Unsubscribe | null = null;

  constructor(opts: SyncManagerOptions) {
    this.vaultId = opts.vaultId;
    this.port = opts.port;
    this.vault = opts.vault ?? createVaultSyncIo(getVaultManager());
    this.now = opts.now ?? (() => new Date());
    this.debounceMs = opts.debounceMs ?? 300;
    this.baseStore = new JsonStore<VaultManifest>(
      opts.basePath ?? baseStorePath(this.vaultId),
      BaseManifestSchema,
      emptyManifest(this.vaultId),
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
  }

  // ---- triggers -----------------------------------------------------------

  /** Subscribe to remote changes (a peer committed something) → debounced sync.
   * The composition root ALSO wires `onVaultChanged` to `scheduleSync` when the
   * capability is enabled; both funnel through the single serialized queue. */
  start(): void {
    if (this.remoteUnsub) return;
    this.remoteUnsub = this.port.subscribe(() => this.scheduleSync());
  }

  /** Stop remote-change subscription + cancel a pending debounce. */
  stop(): void {
    this.remoteUnsub?.();
    this.remoteUnsub = null;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /** Hook the vault-change notifier calls when a local file changed. */
  onVaultChanged(): void {
    this.scheduleSync();
  }

  /** Coalesce a burst of triggers into one sync pass. */
  scheduleSync(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.syncOnce();
    }, this.debounceMs);
  }

  // ---- the pass -----------------------------------------------------------

  /** Run one reconcile+execute pass. Serialized against other in-flight passes.
   * Never throws — a transport failure comes back as `{ status: "error" }` and
   * leaves the base manifest untouched, so the next pass retries from the last
   * clean anchor. */
  syncOnce(): Promise<SyncOutcome> {
    const run = this.queue.then(() => this.runOnce());
    // Keep the chain alive regardless of this run's result.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runOnce(): Promise<SyncOutcome> {
    try {
      const local = this.buildLocalManifest();
      const base = this.loadBase();
      const remote = await this.port.listManifest();
      if (remote.vaultId !== this.vaultId) {
        return {
          status: "error",
          message: `sync: remote vault ${remote.vaultId} != ${this.vaultId}`,
        };
      }

      const plan = reconcile(base, local, remote);

      // The converged coordinator view we advance BASE to: start from the remote
      // snapshot (covers converged + remote-only files) and mutate per applied
      // op. Built from OUR results — never a re-fetch, which could fold in a
      // peer's un-pulled change and make base wrongly imply a local delete.
      const converged = new Map<VaultPath, VaultFile>();
      for (const file of remote.files) converged.set(file.path, file);

      const counts = { pushed: 0, pulled: 0, deleted: 0, conflicts: 0 };
      for (const op of plan.ops) {
        await this.applyOp(op, converged, counts);
      }

      this.saveBase({
        vaultId: this.vaultId,
        generation: remote.generation,
        files: [...converged.values()].toSorted((a, b) => a.path.localeCompare(b.path)),
      });
      return { status: "ok", ...counts };
    } catch (err) {
      // A partial apply left local/remote in a half-converged state; the NEXT
      // pass reconciles fresh from the untouched base (reconcile treats equal
      // hashes as converged, so already-applied ops self-heal).
      return { status: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  private async applyOp(
    op: SyncOp,
    converged: Map<VaultPath, VaultFile>,
    counts: { pushed: number; pulled: number; deleted: number; conflicts: number },
  ): Promise<void> {
    switch (op.kind) {
      case "push": {
        const bytes = this.vault.read(op.path);
        const res = await this.port.putFile(op.path, bytes, op.expectedBaseVersion);
        if (res.ok) {
          converged.set(op.path, res.file);
          counts.pushed += 1;
        } else {
          // A peer moved this path since our snapshot — downgrade to a
          // conflict copy (keep our bytes beside it) and re-pull the winner.
          await this.resolveRemoteWins(op.path, bytes, converged);
          counts.conflicts += 1;
        }
        return;
      }
      case "pull": {
        await this.pullInto(op.file.path, converged);
        counts.pulled += 1;
        return;
      }
      case "delete": {
        if (op.side === "local") {
          this.vault.remove(op.path);
          converged.delete(op.path);
          counts.deleted += 1;
          return;
        }
        const res = await this.port.deleteFile(op.path, op.expectedBaseVersion);
        if (res.ok || res.reason === "not-found") {
          converged.delete(op.path);
          counts.deleted += 1;
        } else {
          // We meant to mirror a local delete, but a peer just edited it —
          // never lose that edit: resurrect the remote copy locally.
          await this.pullInto(op.path, converged);
          counts.pulled += 1;
        }
        return;
      }
      case "conflict-copy": {
        const localBytes = this.vault.read(op.path);
        if (op.winner === "remote") {
          await this.resolveRemoteWins(op.path, localBytes, converged);
        } else {
          await this.resolveLocalWins(op.path, localBytes, op.remote.version, converged);
        }
        counts.conflicts += 1;
        return;
      }
    }
  }

  // ---- op primitives ------------------------------------------------------

  /** Fetch the coordinator's current file at `path` and land it locally. If the
   * coordinator no longer has it (a peer deleted it mid-flight) drop it from the
   * converged view; the next pass reconciles the absence. */
  private async pullInto(path: VaultPath, converged: Map<VaultPath, VaultFile>): Promise<void> {
    const got = await this.port.getFile(path);
    if (!got.ok) {
      converged.delete(path);
      return;
    }
    this.vault.write(path, got.content);
    converged.set(path, got.file);
  }

  /** Remote wins `path`: preserve the local (losing) bytes as a conflict copy,
   * then pull the coordinator's current bytes over `path`. */
  private async resolveRemoteWins(
    path: VaultPath,
    localBytes: Uint8Array,
    converged: Map<VaultPath, VaultFile>,
  ): Promise<void> {
    await this.syncConflictCopy(path, localBytes, converged);
    await this.pullInto(path, converged);
  }

  /** Local wins `path`: preserve the remote (losing) bytes as a conflict copy,
   * then push the local bytes over `path` (based on the remote version we saw).
   * If the coordinator moved again mid-flight, downgrade to remote-wins. */
  private async resolveLocalWins(
    path: VaultPath,
    localBytes: Uint8Array,
    remoteVersion: number,
    converged: Map<VaultPath, VaultFile>,
  ): Promise<void> {
    const got = await this.port.getFile(path);
    if (got.ok) await this.syncConflictCopy(path, got.content, converged);
    const res = await this.port.putFile(path, localBytes, remoteVersion);
    if (res.ok) {
      converged.set(path, res.file);
    } else {
      await this.resolveRemoteWins(path, localBytes, converged);
    }
  }

  /** Write the losing bytes to `conflictCopyName(path, <stamp>)` locally and
   * push the new copy to the coordinator as a create. On the (astronomically
   * unlikely) name collision the copy stays local and the next pass reconciles
   * it — never added to base half-synced. */
  private async syncConflictCopy(
    path: VaultPath,
    losingBytes: Uint8Array,
    converged: Map<VaultPath, VaultFile>,
  ): Promise<void> {
    const copyPath = conflictCopyName(path, this.stamp());
    this.vault.write(copyPath, losingBytes);
    const res = await this.port.putFile(copyPath, losingBytes, ABSENT_VERSION);
    if (res.ok) converged.set(copyPath, res.file);
  }

  // ---- helpers ------------------------------------------------------------

  private buildLocalManifest(): LocalManifest {
    const files: LocalFile[] = [];
    for (const path of this.vault.list()) {
      const bytes = this.vault.read(path);
      files.push({ path, contentHash: sha256Hex(bytes), size: bytes.length });
    }
    return { vaultId: this.vaultId, files };
  }

  private loadBase(): VaultManifest {
    const stored = this.baseStore.read();
    // The per-vault filename already isolates anchors, but guard the id too so a
    // reused file can never seed a foreign vault's base.
    return stored.vaultId === this.vaultId ? stored : emptyManifest(this.vaultId);
  }

  private saveBase(manifest: VaultManifest): void {
    this.baseStore.write(manifest);
  }

  /** A filesystem-safe timestamp for a conflict-copy name (no `:` — Windows/exFAT
   * reject it). @repo/core stays clock-free; the manager supplies this. */
  private stamp(): string {
    return this.now().toISOString().replaceAll(":", "-").replace(".", "-");
  }
}

/** Construct a SyncManager. Factory to mirror the repo's capability constructors
 * and to keep the (future) wiring seam a one-liner. */
export function createSyncManager(opts: SyncManagerOptions): SyncManager {
  return new SyncManager(opts);
}

// ---- module internals -----------------------------------------------------

function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

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
