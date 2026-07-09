// ---------------------------------------------------------------------------
// SyncEngine — the platform-neutral vault-sync engine. It reconciles a LOCAL
// vault against a remote `SyncPort` using @repo/core's pure 3-way merge and
// executes the resulting plan (push/pull/delete/conflict-copy), advancing a
// persisted last-synced BASE manifest as the anchor.
//
// Purity split (mirrors the rest of @repo/core): `reconcile` decides WHAT to do
// from three manifests and reads no clock, does no I/O, hashes nothing. This
// engine supplies all of that through INJECTED platform ports, so ONE
// implementation serves node (desktop) and React Native (mobile) alike:
//   - `io`    reads/writes the local vault bytes
//   - `port`  is the remote transport
//   - `base`  persists the last-synced anchor
//   - `hash`  content-addresses local files (async — RN/web have no sync sha256)
//   - `stamp` names conflict copies with a filesystem-safe timestamp
// Only VAULT FILES are synced; derived state (the knowledge index and all
// AI/editor state) lives outside the vault and is never listed here, so it can't
// leak into the protocol. `setTimeout`/`clearTimeout` are the only ambient
// globals used — universal across the target runtimes.
// ---------------------------------------------------------------------------

import type { LocalFile, LocalManifest, VaultManifest } from "./manifest";
import type { SyncOp } from "./plan";
import type { SyncPort, Unsubscribe } from "./sync-port";
import { ABSENT_VERSION, type VaultFile, type VaultPath } from "./vault-file";
import { conflictCopyName, reconcile } from "./reconcile";
import type { BaseStore } from "./base-store";

// ---------------------------------------------------------------------------
// Injected platform ports.
// ---------------------------------------------------------------------------

/**
 * The narrow slice of the local vault the engine touches — a port so the engine
 * is unit-testable against an in-memory map and never imports a filesystem
 * directly. (The desktop adapts a `VaultManager` to it.)
 */
export type SyncIo = {
  /** Vault-relative POSIX paths of every file (all kinds — assets sync too). */
  list(): readonly VaultPath[];
  /** Raw bytes of a vault file. */
  read(path: VaultPath): Uint8Array;
  /** Atomically write raw bytes to a vault file (creating parent dirs). */
  write(path: VaultPath, content: Uint8Array): void;
  /** Remove a vault file (idempotent — absent is fine). */
  remove(path: VaultPath): void;
  /** Cheap change-detection key for a file (e.g. "mtimeMs:size:ino"), or null
   * when unavailable. OPTIONAL — platforms without cheap stat omit it and the
   * engine re-hashes every file (previous behavior). A stale fingerprint must
   * be impossible: the key must change whenever content can have changed. */
  fingerprint?(path: VaultPath): string | null;
};

/**
 * Content-address a file's raw bytes as a lowercase sha-256 hex digest. ASYNC:
 * React Native and the browser only expose an async digest (`crypto.subtle`), so
 * the engine awaits it — the node desktop wraps its sync digest in a resolved
 * promise.
 */
export type Hasher = (bytes: Uint8Array) => Promise<string>;

/**
 * A filesystem-safe timestamp for a conflict-copy name (no `:` — Windows/exFAT
 * reject it). @repo/core stays clock-free; the platform adapter supplies this.
 */
export type Clock = () => string;

/** What one `syncOnce` pass did (or why it failed). */
export type SyncOutcome =
  | {
      readonly status: "ok";
      readonly pushed: number;
      readonly pulled: number;
      readonly deleted: number;
      readonly conflicts: number;
      /** Conflict-COPY paths created this pass (the sibling files preserving
       * each conflict's losing bytes) — what a conflict UI lists and opens.
       * May differ from `conflicts`: one conflict can spawn two copies (a
       * local-wins downgraded to remote-wins mid-flight) or none (the remote
       * loser vanished before it could be copied). */
      readonly conflictPaths: readonly VaultPath[];
    }
  | { readonly status: "error"; readonly message: string };

export type SyncEngineOptions = {
  /** The remote vault this client syncs. Scopes the SyncPort + the base store. */
  readonly vaultId: string;
  /** The remote transport (an HttpSyncPort in production; a fake in tests). */
  readonly port: SyncPort;
  /** Local vault access. */
  readonly io: SyncIo;
  /** Persistence for the last-synced base manifest. */
  readonly base: BaseStore;
  /** Content-address local files. */
  readonly hash: Hasher;
  /** Filesystem-safe timestamp source for conflict-copy names. */
  readonly stamp: Clock;
  /** Debounce window (ms) for `scheduleSync`. Default 300ms. */
  readonly debounceMs?: number | undefined;
  /** Fires after EVERY completed pass — whether triggered by an explicit
   * `syncOnce()` call or an internal debounced one (`scheduleSync`,
   * `onVaultChanged`, the remote-change subscription). `syncOnce()`'s return
   * value already covers its own caller; this is what lets a platform surface
   * a debounced pass's conflicts/status without polling. Called synchronously
   * before the pass's promise resolves, so a caller awaiting `syncOnce()` sees
   * this side effect already applied. */
  readonly onOutcome?: ((outcome: SyncOutcome) => void) | undefined;
};

// ---------------------------------------------------------------------------
// SyncEngine
// ---------------------------------------------------------------------------

export class SyncEngine {
  private readonly vaultId: string;
  private readonly port: SyncPort;
  private readonly io: SyncIo;
  private readonly base: BaseStore;
  private readonly hash: Hasher;
  private readonly stamp: Clock;
  private readonly debounceMs: number;
  private readonly onOutcome: ((outcome: SyncOutcome) => void) | undefined;

  // Stat-keyed hash cache: a passing fingerprint lets a pass reuse a file's
  // hash without re-reading it. Keyed by path; invalidated whenever the engine
  // itself writes/removes a file (the fingerprint would otherwise go stale).
  private readonly hashCache = new Map<
    VaultPath,
    { fp: string; contentHash: string; size: number }
  >();

  // Serialize passes so two never overlap (a debounce fire during an in-flight
  // pass queues behind it rather than racing the same files).
  private queue: Promise<unknown> = Promise.resolve();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private remoteUnsub: Unsubscribe | null = null;

  constructor(opts: SyncEngineOptions) {
    this.vaultId = opts.vaultId;
    this.port = opts.port;
    this.io = opts.io;
    this.base = opts.base;
    this.hash = opts.hash;
    this.stamp = opts.stamp;
    this.debounceMs = opts.debounceMs ?? 300;
    this.onOutcome = opts.onOutcome;
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
   * clean anchor. `onOutcome` fires here — the single exit point for every
   * pass, explicit or debounced — rather than inside `runOnce()`, so a future
   * exit path there can't accidentally skip the notification. */
  syncOnce(): Promise<SyncOutcome> {
    const run = this.queue
      .then(() => this.runOnce())
      .then((outcome) => {
        try {
          this.onOutcome?.(outcome);
        } catch {
          // onOutcome is a platform-supplied side effect; a bug there must not
          // break syncOnce's "never throws" contract for its caller.
        }
        return outcome;
      });
    // Keep the chain alive regardless of this run's result.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runOnce(): Promise<SyncOutcome> {
    try {
      const local = await this.buildLocalManifest();
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
      const conflictPaths: VaultPath[] = [];
      for (const op of plan.ops) {
        await this.applyOp(op, converged, counts, conflictPaths);
      }

      this.saveBase({
        vaultId: this.vaultId,
        generation: remote.generation,
        files: [...converged.values()].toSorted((a, b) => a.path.localeCompare(b.path)),
      });
      return { status: "ok", ...counts, conflictPaths };
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
    conflictPaths: VaultPath[],
  ): Promise<void> {
    switch (op.kind) {
      case "push": {
        const bytes = this.io.read(op.path);
        const res = await this.port.putFile(op.path, bytes, op.expectedBaseVersion);
        if (res.ok) {
          converged.set(op.path, res.file);
          counts.pushed += 1;
        } else {
          // A peer moved this path since our snapshot — downgrade to a
          // conflict copy (keep our bytes beside it) and re-pull the winner.
          await this.resolveRemoteWins(op.path, bytes, converged, conflictPaths);
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
          this.io.remove(op.path);
          this.hashCache.delete(op.path);
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
        const localBytes = this.io.read(op.path);
        if (op.winner === "remote") {
          await this.resolveRemoteWins(op.path, localBytes, converged, conflictPaths);
        } else {
          await this.resolveLocalWins(
            op.path,
            localBytes,
            op.remote.version,
            converged,
            conflictPaths,
          );
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
    this.io.write(path, got.content);
    this.hashCache.delete(path);
    converged.set(path, got.file);
  }

  /** Remote wins `path`: preserve the local (losing) bytes as a conflict copy,
   * then pull the coordinator's current bytes over `path`. */
  private async resolveRemoteWins(
    path: VaultPath,
    localBytes: Uint8Array,
    converged: Map<VaultPath, VaultFile>,
    conflictPaths: VaultPath[],
  ): Promise<void> {
    await this.syncConflictCopy(path, localBytes, converged, conflictPaths);
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
    conflictPaths: VaultPath[],
  ): Promise<void> {
    const got = await this.port.getFile(path);
    if (got.ok) await this.syncConflictCopy(path, got.content, converged, conflictPaths);
    const res = await this.port.putFile(path, localBytes, remoteVersion);
    if (res.ok) {
      converged.set(path, res.file);
    } else {
      await this.resolveRemoteWins(path, localBytes, converged, conflictPaths);
    }
  }

  /** Write the losing bytes to `conflictCopyName(path, <stamp>)` locally and
   * push the new copy to the coordinator as a create. On the (astronomically
   * unlikely) name collision the copy stays local and the next pass reconciles
   * it — never added to base half-synced. Records the copy in `conflictPaths`
   * so the pass's outcome can name what it created. */
  private async syncConflictCopy(
    path: VaultPath,
    losingBytes: Uint8Array,
    converged: Map<VaultPath, VaultFile>,
    conflictPaths: VaultPath[],
  ): Promise<void> {
    const copyPath = conflictCopyName(path, this.stamp());
    this.io.write(copyPath, losingBytes);
    this.hashCache.delete(copyPath);
    conflictPaths.push(copyPath);
    const res = await this.port.putFile(copyPath, losingBytes, ABSENT_VERSION);
    if (res.ok) converged.set(copyPath, res.file);
  }

  // ---- helpers ------------------------------------------------------------

  private async buildLocalManifest(): Promise<LocalManifest> {
    const files: LocalFile[] = [];
    const seen = new Set<VaultPath>();
    for (const path of this.io.list()) {
      seen.add(path);
      const fp = this.io.fingerprint?.(path) ?? null;
      if (fp !== null) {
        const cached = this.hashCache.get(path);
        if (cached && cached.fp === fp) {
          // Fingerprint matches — content can't have changed; reuse the hash.
          files.push({ path, contentHash: cached.contentHash, size: cached.size });
          continue;
        }
      }
      const bytes = this.io.read(path);
      const contentHash = await this.hash(bytes);
      const size = bytes.length;
      files.push({ path, contentHash, size });
      // Only cache when we have a fingerprint to validate future reuse against.
      if (fp !== null) this.hashCache.set(path, { fp, contentHash, size });
    }
    // Prune entries for files that vanished from the vault since last pass.
    for (const path of this.hashCache.keys()) {
      if (!seen.has(path)) this.hashCache.delete(path);
    }
    return { vaultId: this.vaultId, files };
  }

  private loadBase(): VaultManifest {
    const stored = this.base.load();
    // The per-vault base store already isolates anchors, but guard the id too so
    // a reused store can never seed a foreign vault's base. `null` (first sync)
    // and a mismatch both start from empty.
    if (stored === null || stored.vaultId !== this.vaultId) return this.emptyManifest();
    return stored;
  }

  private saveBase(manifest: VaultManifest): void {
    this.base.save(manifest);
  }

  private emptyManifest(): VaultManifest {
    return { vaultId: this.vaultId, generation: 0, files: [] };
  }
}
