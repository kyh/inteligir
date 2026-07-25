// ---------------------------------------------------------------------------
// SyncEngine — the platform-neutral vault-sync engine. It reconciles a LOCAL
// vault against a remote `SyncPort` using @repo/notes's pure 3-way merge and
// executes the resulting plan (push/pull/delete/conflict-copy), advancing a
// persisted last-synced BASE manifest as the anchor.
//
// Purity split (mirrors the rest of @repo/notes): `reconcile` decides WHAT to do
// from three manifests and reads no clock, does no I/O, hashes nothing. This
// engine supplies all of that through INJECTED platform ports, so ONE
// implementation serves node (desktop) and React Native (mobile) alike:
//   - `io`    reads/writes the local vault bytes
//   - `port`  is the remote transport
//   - `base`  persists the last-synced anchor
//   - `blobs` holds last-synced base BYTES (markdown) for the merge ladder
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
import { ABSENT_VERSION, type Hash, type VaultFile, type VaultPath } from "./vault-file";
import { conflictCopyName, reconcile } from "./reconcile";
import type { BaseStore } from "./base-store";
import type { BaseBlobStore } from "./blob-store";
import { mergeLadder, type MergeBase } from "./merge/ladder";

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
 * reject it). @repo/notes stays clock-free; the platform adapter supplies this.
 */
export type Clock = () => string;

/** The merge ladder applies to markdown only — base blobs are never kept for
 * (and merges never attempted on) binary assets. */
function isMarkdownPath(path: VaultPath): boolean {
  return path.endsWith(".md");
}

/** Per-side size cap for a ladder attempt — a pathological note falls back to
 * the conflict copy rather than stalling a pass on line-diffing megabytes. */
const MAX_MERGE_BYTES = 4 * 1024 * 1024;

/** Change-stream reconnect backoff: 1s, 2s, 4s … capped at 30s. */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** What one `syncOnce` pass did (or why it failed). */
export type SyncOutcome =
  | {
      readonly status: "ok";
      readonly pushed: number;
      readonly pulled: number;
      readonly deleted: number;
      readonly conflicts: number;
      /** Both-sides-changed files the merge LADDER resolved (no conflict copy,
       * nothing counted in `conflicts`/`conflictPaths`) — a merged path never
       * appears in a conflict UI. */
      readonly merged: number;
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
  /** Content-addressed store for last-synced base BYTES (markdown only) —
   * what arms the merge ladder with a true 3-way base. */
  readonly blobs: BaseBlobStore;
  /** Debounce window (ms) for `scheduleSync`. Default 300ms. */
  readonly debounceMs?: number | undefined;
  /** Fires after EVERY completed pass — whether triggered by an explicit
   * `syncOnce()` call or an internal debounced one (`scheduleSync`,
   * the remote-change subscription). `syncOnce()`'s return
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
  private readonly blobs: BaseBlobStore;
  private readonly debounceMs: number;
  private readonly onOutcome: ((outcome: SyncOutcome) => void) | undefined;

  // Stat-keyed hash cache: a passing fingerprint lets a pass reuse a file's
  // hash without re-reading it. Keyed by path; invalidated whenever the engine
  // itself writes/removes a file (the fingerprint would otherwise go stale).
  private readonly hashCache = new Map<VaultPath, { fp: string; contentHash: string }>();

  // Serialize passes so two never overlap (a debounce fire during an in-flight
  // pass queues behind it rather than racing the same files).
  private queue: Promise<unknown> = Promise.resolve();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private remoteUnsub: Unsubscribe | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;

  constructor(opts: SyncEngineOptions) {
    this.vaultId = opts.vaultId;
    this.port = opts.port;
    this.io = opts.io;
    this.base = opts.base;
    this.hash = opts.hash;
    this.stamp = opts.stamp;
    this.blobs = opts.blobs;
    this.debounceMs = opts.debounceMs ?? 300;
    this.onOutcome = opts.onOutcome;
  }

  // ---- triggers -----------------------------------------------------------

  /** Subscribe to remote changes (a peer committed something) → debounced sync.
   * The composition root ALSO wires local vault-change notifications to
   * `scheduleSync` when the capability is enabled; both funnel through the
   * single serialized queue.
   *
   * SUPERVISED: the change stream is long-lived and dies on any network blip.
   * A port that reports terminations (`subscribe`'s optional `onEnd` — see
   * HttpSyncPort) gets the subscription reopened with exponential backoff,
   * because otherwise one dropped connection silently demotes the client to
   * whatever else happens to call `scheduleSync` (a periodic timer, window
   * focus) for the rest of the engine's life. A received change resets the
   * backoff: a live frame is proof the connection works.
   *
   * Platforms that must rebuild the PORT per attempt (mobile rotates a bearer
   * token per stream) supervise outside the engine instead and never call
   * `start()` — see apps/mobile/src/lib/sync/realtime.ts. */
  start(): void {
    if (this.remoteUnsub !== null || this.reconnectTimer !== null) return;
    this.reconnectAttempt = 0;
    this.openRemote();
  }

  /** Stop remote-change subscription + cancel a pending debounce/reconnect. */
  stop(): void {
    this.remoteUnsub?.();
    this.remoteUnsub = null;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** One subscription attempt. `onEnd` fires only for terminations the engine
   * did NOT cause, so an explicit `stop()` can never schedule a reconnect. */
  private openRemote(): void {
    this.reconnectTimer = null;
    this.remoteUnsub = this.port.subscribe(
      () => {
        this.reconnectAttempt = 0;
        this.scheduleSync();
      },
      () => {
        this.remoteUnsub = null;
        this.scheduleReconnect();
      },
    );
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** Math.min(this.reconnectAttempt, 16),
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.openRemote(), delay);
    // A drop means we may have missed peer commits; the next successful pass
    // reconciles them, so kick one as soon as the stream is back.
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
      // MASS-DELETION GUARD (#429): an empty local listing against a non-empty
      // last-synced base is treated as a failed/truncated vault read (root
      // unmounted, a crawl error), NEVER as the user having deleted every
      // file — reconcile would read each base path as a local delete and fan
      // it out to the coordinator and every peer. Refuse the pass: zero ops,
      // base untouched, so the next pass retries from the same clean anchor.
      // Platform crawls already fail loudly on unreadable roots (the vault's
      // listing-completeness flag, mobile's root-missing throw); this is the
      // belt-and-suspenders layer that holds even if some future IO produces
      // an empty listing without throwing. Deliberately NOT extended to
      // "local much smaller than base" — that would false-positive on legit
      // bulk deletes; partial truncation is Layer 1's job. A REAL
      // delete-everything is rare and pays this toll: sync resumes as soon
      // as any file exists locally again (or the deletion is made from a
      // device that still has files).
      if (local.files.length === 0 && base.files.length > 0) {
        return {
          status: "error",
          message:
            `sync: the local vault listing is empty but the last sync recorded ${base.files.length} ` +
            "file(s) — pausing instead of propagating a mass deletion to every device. Check that " +
            "the vault folder is present and readable, then retry. If you really deleted every " +
            "file, add any file to the vault (or delete the files from another device) to resume.",
        };
      }
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

      const counts = { pushed: 0, pulled: 0, deleted: 0, conflicts: 0, merged: 0 };
      const conflictPaths: VaultPath[] = [];
      for (const op of plan.ops) {
        await this.applyOp(op, converged, counts, conflictPaths);
      }

      this.saveBase({
        vaultId: this.vaultId,
        files: [...converged.values()].toSorted((a, b) => a.path.localeCompare(b.path)),
      });
      // Blob GC: the new base is the ONLY thing base bytes serve — drop every
      // blob it no longer references. Over-deleting degrades to a conflict
      // copy (safe); this keeps the shadow from outgrowing the vault.
      const keep = new Set<Hash>();
      for (const file of converged.values()) {
        if (isMarkdownPath(file.path)) keep.add(file.contentHash);
      }
      this.blobs.prune(keep);
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
    counts: { pushed: number; pulled: number; deleted: number; conflicts: number; merged: number },
    conflictPaths: VaultPath[],
  ): Promise<void> {
    switch (op.kind) {
      case "push": {
        const bytes = this.io.read(op.path);
        const res = await this.port.putFile(op.path, bytes, op.expectedBaseVersion);
        if (res.ok) {
          converged.set(op.path, res.file);
          this.captureBlob(op.path, res.file.contentHash, bytes);
          counts.pushed += 1;
        } else if (await this.tryLadder(op.path, op.baseHash, bytes, converged)) {
          // A peer moved this path mid-flight, but the ladder merged both
          // sides cleanly — no conflict, no copy.
          counts.merged += 1;
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
        // Both sides changed since base — the merge ladder first; only when it
        // refuses does last-write-wins + a conflict copy resolve the fork.
        if (await this.tryLadder(op.path, op.baseHash, localBytes, converged)) {
          counts.merged += 1;
          return;
        }
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

  /**
   * The merge ladder around one both-sides-changed path: fetch the current
   * remote bytes, look the true base bytes up in the blob store (by the base
   * manifest's contentHash carried on the op), and run the pure `mergeLadder`.
   * On a merge: hash-equal to the remote → land the bytes locally with ZERO
   * coordinator traffic; otherwise push them at the remote's version — a
   * version-conflict there (a peer moved mid-flight) re-fetches and re-merges
   * exactly ONCE. `false` means "not merged" and the caller resolves the
   * conflict exactly as before the ladder existed. Markdown only, both sides
   * capped so a huge note can't stall a pass.
   */
  private async tryLadder(
    path: VaultPath,
    baseHash: Hash | null,
    localBytes: Uint8Array,
    converged: Map<VaultPath, VaultFile>,
  ): Promise<boolean> {
    if (!isMarkdownPath(path) || localBytes.length > MAX_MERGE_BYTES) return false;
    let base: MergeBase = { kind: "absent" };
    if (baseHash !== null) {
      const bytes = this.blobs.get(baseHash);
      // A base manifest entry whose bytes we no longer (or never — legacy)
      // hold is UNAVAILABLE, not absent: rungs that would guess refuse it.
      base = bytes === null ? { kind: "unavailable" } : { kind: "bytes", bytes };
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const got = await this.port.getFile(path);
      if (!got.ok) return false; // remote vanished mid-flight — the caller's fallback reconciles
      // Capture the fetched remote bytes now — if the merge lands hash-equal,
      // this is the new base's blob (not stored anywhere else until next pass).
      this.blobs.put(got.file.contentHash, got.content);
      if (got.content.length > MAX_MERGE_BYTES) return false;
      const result = mergeLadder({ base, local: localBytes, remote: got.content });
      if (result.kind === "conflict") return false;
      if ((await this.hash(result.bytes)) === got.file.contentHash) {
        // The merge IS the remote content (whitespace rung, or our tail was
        // already incorporated) — land it locally, zero coordinator traffic.
        this.io.write(path, result.bytes);
        this.hashCache.delete(path);
        converged.set(path, got.file);
        return true;
      }
      const res = await this.port.putFile(path, result.bytes, got.file.version);
      if (res.ok) {
        this.io.write(path, result.bytes);
        this.hashCache.delete(path);
        converged.set(path, res.file);
        this.blobs.put(res.file.contentHash, result.bytes);
        return true;
      }
      // version-conflict: a peer committed between our getFile and putFile —
      // loop re-fetches + re-merges once, then gives up to a conflict copy.
    }
    return false;
  }

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
    this.captureBlob(path, got.file.contentHash, got.content);
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
      this.captureBlob(path, res.file.contentHash, localBytes);
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
    if (res.ok) {
      converged.set(copyPath, res.file);
      this.captureBlob(copyPath, res.file.contentHash, losingBytes);
    }
  }

  // ---- helpers ------------------------------------------------------------

  /** Shadow markdown bytes into the blob store at a moment the engine already
   * holds bytes + hash — atomic with base advancement, so the shadow is EXACT. */
  private captureBlob(path: VaultPath, contentHash: Hash, bytes: Uint8Array): void {
    if (isMarkdownPath(path)) this.blobs.put(contentHash, bytes);
  }

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
          files.push({ path, contentHash: cached.contentHash });
          continue;
        }
      }
      const bytes = this.io.read(path);
      const contentHash = await this.hash(bytes);
      files.push({ path, contentHash });
      // Every read+hash is a capture moment — this is ALSO what backfills a
      // legacy base (pre-blob-store) with bytes for every still-converged file.
      this.captureBlob(path, contentHash, bytes);
      // Only cache when we have a fingerprint to validate future reuse against.
      if (fp !== null) this.hashCache.set(path, { fp, contentHash });
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
    return { vaultId: this.vaultId, files: [] };
  }
}
