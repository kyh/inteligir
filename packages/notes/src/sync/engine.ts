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
import type { SyncOp, SyncPlan } from "./plan";
import type { SyncPort, Unsubscribe } from "./sync-port";
import { ABSENT_VERSION, type Hash, type VaultFile, type VaultPath } from "./vault-file";
import { conflictCopyName, reconcile } from "./reconcile";
import type { BaseStore, StoredBase } from "./base-store";
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
  /** WHERE the local vault lives, as a stable resolved identity (the desktop's
   * vault root path). Read fresh every pass, because the user can repoint the
   * vault while an engine is live. OPTIONAL — a platform whose vault root
   * cannot move omits it and the base anchor records no root. */
  root?(): string;
  /** Raw bytes of a vault file. */
  read(path: VaultPath): Uint8Array;
  /** Atomically write raw bytes to a vault file (creating parent dirs). */
  write(path: VaultPath, content: Uint8Array): void;
  /** Remove a vault file (idempotent — absent is fine). */
  remove(path: VaultPath): void;
  /** Cheap change-detection key for a file (e.g. "mtimeMs:size:ino"), or null
   * when unavailable. OPTIONAL — platforms without cheap stat omit it and the
   * engine re-hashes every file instead. A stale fingerprint must
   * be impossible: the key must change whenever content can have changed. */
  fingerprint?(path: VaultPath): string | null;
  /** Paths the local crawl SAW but could not present as files — a symlink
   * where a note used to be, or a cloud placeholder standing in for evicted
   * bytes (reported under the REAL name it stands in for, not the stub's).
   * They are absent from `list()`, which reconcile would read as a local
   * delete, yet the bytes are alive on every other device. The engine is the
   * only layer that can tell the difference, because only it holds the
   * last-synced base. OPTIONAL — a platform with no such concept omits it and
   * every path it lists is a file it read. */
  unaccounted?(): readonly VaultPath[];
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

/**
 * The order a pass applies its ops in — `reconcile` sorts by path, which says
 * nothing about safety. Stable within a phase, so path order still decides ties.
 *
 * LOCAL DELETES FIRST. A case-only rename on a peer (`note.md` → `Note.md`)
 * arrives as a delete of the old spelling plus a pull of the new one, and on a
 * case-insensitive filesystem those two paths are ONE file: run the delete
 * second and it removes the bytes the pull just landed, leaving nothing — which
 * the next pass reports to every device as a deletion. Path order cannot save
 * it (which spelling sorts first is decided by the letters) and the mirror-image
 * rename breaks the opposite phase, so the delete has to precede every write.
 *
 * REMOTE DELETES LAST, for the crash window rather than the filesystem: the
 * push that carries the renamed file's bytes must land on the coordinator
 * before the old path is dropped, or a pass that dies in between leaves the
 * content on this device only, with every peer told to delete its copy.
 */
function applyPhase(op: SyncOp): number {
  if (op.kind !== "delete") return 1;
  return op.side === "local" ? 0 : 2;
}

/** How many offending paths a refusal names before it counts the rest — enough
 * to act on, short enough to read in a toast. */
const MAX_NAMED_PATHS = 5;

// ---------------------------------------------------------------------------
// Deletion gate — the layer that BOUNDS what a leaked listing invariant costs.
//
// Every mass-deletion bug this vault has shipped had one shape: the local
// manifest shrank while nothing left the disk, and the 3-way reconcile read
// "in base, absent from local" as a permanent delete on every device. Each
// individual cause (a .gitignore edit, a vault repoint, a case-only rename, a
// symlink, a pruned dot-entry, a platform exclusion mismatch) was closed by a
// listing rule — which only holds until the next listing rule leaks. This gate
// asks a different question, one no crawl can answer wrongly: is the SIZE of
// this deletion consistent with a human having asked for it?
//
// What it is NOT, and must never be described as: a detector. It reads a
// COUNT, never a cause, so a leak that sheds ONE path — a single case-only
// rename, one symlink where a note used to be — sits far below the floor and
// passes straight through, losing that file on every device exactly as it
// would have without the gate. Catching those is the listing rules' job. This
// layer caps the blast radius of the ones they miss, and nothing more.
//
// Two shapes must both hold. A small vault must not stall on an ordinary
// cleanup, which is what the absolute floor buys: below it, no plan is ever
// held, so clearing out a season of daily notes syncs silently. The floor is
// deliberately high — a confirmation the user meets while tidying is one they
// learn to click through, and a trained click-through costs more on the one
// pass that matters than the dialog ever bought. A large vault must not lose
// hundreds of files to a bug no human would ever confirm, which is what the
// proportion buys — 5% of a 5,000-note vault is 250 files, so a 400-file
// phantom deletion holds while a deliberate 100-file purge does not. The floor
// dominates until 500 files, the proportion after; both are policy, tuned to
// stay quiet on the deletes users actually make.
// ---------------------------------------------------------------------------
const MIN_HELD_DELETIONS = 25;
const HELD_DELETION_SHARE = 0.05;

/** Vault paths this plan would remove, from EITHER side — a pull that
 * overwrites local bytes is not a deletion, and a remote delete costs every
 * other device its copy exactly as a local one does. */
function plannedDeletions(plan: SyncPlan): VaultPath[] {
  const paths: VaultPath[] = [];
  for (const op of plan.ops) {
    if (op.kind === "delete") paths.push(op.path);
  }
  return paths;
}

function exceedsDeletionGate(deletions: number, baseCount: number): boolean {
  return deletions > Math.max(MIN_HELD_DELETIONS, HELD_DELETION_SHARE * baseCount);
}

/** Why a pass refused, in terms the user can act on. The port answers with
 * PATHS, not causes, so the message names the remedy for each shape a platform
 * can report rather than guessing which one applies to a given path. */
function unaccountedMessage(paths: readonly VaultPath[]): string {
  const named = paths
    .slice(0, MAX_NAMED_PATHS)
    .map((path) => `"${path}"`)
    .join(", ");
  const rest = paths.length - MAX_NAMED_PATHS;
  return (
    `sync: ${paths.length} file(s) the last sync recorded are no longer readable as files here — ` +
    `${rest > 0 ? `${named} and ${rest} more` : named}. If a file lives in the cloud but is not ` +
    "on this device, open it to download it (or turn off Optimize Storage for that folder); if " +
    "it is now a link, sync cannot represent one — put the real file back in its place. Pausing " +
    "instead of reporting them deleted on every device."
  );
}

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
  | {
      /** The plan would have deleted more files than the gate allows without a
       * human saying so. NOTHING was applied — not the deletes, not the pushes
       * or pulls beside them — and the base anchor is untouched, so a confirmed
       * retry reconciles from exactly the same state. */
      readonly status: "held";
      readonly deletions: number;
      /** Files the last sync recorded, for "N of M" phrasing. */
      readonly baseCount: number;
      /** A few of the paths that would go, for the confirmation UI. */
      readonly sample: readonly VaultPath[];
    }
  | { readonly status: "error"; readonly message: string };

/** Per-pass options. Deliberately not engine state: `confirmDeletions` applies
 * to ONE pass and is never remembered, so a confirmation can never authorize a
 * deletion the user never saw. */
export type SyncPassOptions = {
  /** Waive the deletion gate for this pass, for AT MOST this many deletions —
   * the count the user was shown when they approved. A confirmed pass re-crawls
   * and re-reconciles from scratch, so the plan it produces need not be the
   * plan that was held: a bigger one is a DIFFERENT deletion the user never
   * saw, and holds again with the new number rather than riding a waiver
   * written for a smaller one. ONLY an explicit human action may set it — a
   * debounced, periodic or realtime-triggered pass that confirmed its own
   * deletions would be worse than no gate at all, because it would look like
   * protection. */
  readonly confirmDeletions?: number | undefined;
};

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

  /** Coalesce a burst of triggers into one sync pass. Never confirms deletions:
   * nobody is watching a debounced pass, so it can only ever report a hold. */
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
   * clean anchor; a `{ status: "held" }` outcome is the deletion gate refusing
   * the whole plan on the same terms, and `opts.confirmDeletions` (an explicit
   * human confirmation of a specific count, never an automatic trigger) waives
   * it for this pass up to that count.
   * `onOutcome` fires here — the single exit point for every pass, explicit or
   * debounced — rather than inside `runOnce()`, so a future exit path there
   * can't accidentally skip the notification. */
  syncOnce(opts?: SyncPassOptions): Promise<SyncOutcome> {
    const run = this.queue
      .then(() => this.runOnce(opts?.confirmDeletions))
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

  private async runOnce(confirmDeletions: number | undefined): Promise<SyncOutcome> {
    try {
      const vaultRoot = this.currentRoot();
      const local = await this.buildLocalManifest();
      const base = this.loadBase(vaultRoot);
      // EMPTY-LISTING GUARD: an empty local listing against a non-empty
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
      // UNACCOUNTED-FOR FILES: something stands where a file used to be that
      // the crawl could not read as one. It is missing from `local`, which
      // reconcile reads as a local delete — so refuse the pass for exactly the
      // paths the LAST SYNC recorded, and only those. One the base never held
      // was never pushed anywhere, so leaving it out of a manifest deletes
      // nothing; refusing on it would let a single stray symlink under the
      // vault wedge sync permanently, with no in-app remedy.
      const unaccounted = this.unaccountedInBase(base);
      if (unaccounted.length > 0) {
        return { status: "error", message: unaccountedMessage(unaccounted) };
      }
      const remote = await this.port.listManifest();
      if (remote.vaultId !== this.vaultId) {
        return {
          status: "error",
          message: `sync: remote vault ${remote.vaultId} != ${this.vaultId}`,
        };
      }

      const plan = reconcile(base, local, remote);

      // DELETION GATE: a plan is a whole; hold it entirely rather than applying
      // the writes and skipping the deletes, because a half-applied plan
      // advances nothing the user can reason about. Counted from the reconciled
      // plan BEFORE any op runs, so no WRITE ever reaches the coordinator — the
      // manifest listing above has already happened and is the pass's only
      // remote cost, paid again on every retry until a human decides. A
      // confirmation covers only the count it was given: this pass re-crawled
      // and re-reconciled, so a plan that grew since the hold holds again with
      // the new number for the user to approve on sight.
      // Independent of the two guards above ON PURPOSE — they recognize
      // specific broken listings, this one recognizes an implausible RESULT and
      // needs no listing invariant to be true. It caps what a leaked invariant
      // costs; it does not find one (a leak shedding a single path is under the
      // floor and passes straight through).
      const deletions = plannedDeletions(plan);
      const waived = confirmDeletions !== undefined && deletions.length <= confirmDeletions;
      if (!waived && exceedsDeletionGate(deletions.length, base.files.length)) {
        return {
          status: "held",
          deletions: deletions.length,
          baseCount: base.files.length,
          sample: deletions.slice(0, MAX_NAMED_PATHS),
        };
      }

      // The converged coordinator view we advance BASE to: start from the remote
      // snapshot (covers converged + remote-only files) and mutate per applied
      // op. Built from OUR results — never a re-fetch, which could fold in a
      // peer's un-pulled change and make base wrongly imply a local delete.
      const converged = new Map<VaultPath, VaultFile>();
      for (const file of remote.files) converged.set(file.path, file);

      const counts = { pushed: 0, pulled: 0, deleted: 0, conflicts: 0, merged: 0 };
      const conflictPaths: VaultPath[] = [];
      for (const op of plan.ops.toSorted((a, b) => applyPhase(a) - applyPhase(b))) {
        await this.applyOp(op, converged, counts, conflictPaths);
      }

      this.saveBase({
        vaultId: this.vaultId,
        vaultRoot,
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
      // A base manifest entry whose bytes we do not hold (never captured, or
      // pruned) is UNAVAILABLE, not absent: rungs that would guess refuse it.
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
      // Every read+hash is a capture moment — this is ALSO what backfills base
      // bytes for still-converged files whose blob is missing from the shadow.
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

  /** The last-synced paths this pass's crawl could not account for — the
   * intersection of the platform's unaccounted-for set with the base anchor.
   * Empty on a platform that reports none. */
  private unaccountedInBase(base: VaultManifest): VaultPath[] {
    const unaccounted = this.io.unaccounted?.();
    if (unaccounted === undefined || unaccounted.length === 0) return [];
    const unreadable = new Set(unaccounted);
    // Ancestor-aware: a crawl reports an unreadable DIRECTORY as one path, so a
    // synced subtree replaced by a symlink to it ("notes" moved out and linked
    // back) reports `notes` while the base holds `notes/a.md`. Exact membership
    // sees no overlap and reconcile deletes the whole subtree — the failure this
    // guard exists to stop. Walking prefixes costs O(depth) per file, and an
    // unreadable FILE still only ever matches itself.
    return base.files
      .filter((file) => {
        if (unreadable.has(file.path)) return true;
        let cut = file.path.lastIndexOf("/");
        while (cut > 0) {
          if (unreadable.has(file.path.slice(0, cut))) return true;
          cut = file.path.lastIndexOf("/", cut - 1);
        }
        return false;
      })
      .map((file) => file.path);
  }

  /** Where the local vault lives right now, or null on a platform whose vault
   * cannot move. Read per pass — the user can repoint the vault under a live
   * engine. */
  private currentRoot(): string | null {
    return this.io.root?.() ?? null;
  }

  private loadBase(vaultRoot: string | null): VaultManifest {
    const stored = this.base.load();
    // The per-vault base store already isolates anchors, but guard the id too so
    // a reused store can never seed a foreign vault's base. `null` (first sync)
    // and a mismatch both start from empty.
    if (stored === null || stored.vaultId !== this.vaultId) return this.emptyManifest();
    // Same guard one field wider: an anchor describes the FOLDER it was taken
    // against. Repoint the vault and the new folder holds none of the old
    // folder's paths — against the old anchor that reads as a deletion of every
    // one of them, fanned out to the coordinator and every device. An empty base
    // instead ADOPTS the new folder (everything pushes, nothing deletes), the
    // same semantics a first sign-in gets.
    //
    // Only a root that is RECORDED and DIFFERS is a repoint. An anchor written
    // before this field existed has none, and it is already scoped by vaultId to
    // a per-vaultId file this install wrote — reading that as a mismatch would
    // discard the anchor on the first pass after upgrade for every existing
    // install, which is the whole-vault re-push this guard exists to prevent.
    // The live root is stamped on the next save.
    if (vaultRoot !== null && stored.vaultRoot !== null && stored.vaultRoot !== vaultRoot) {
      return this.emptyManifest();
    }
    return stored;
  }

  private saveBase(base: StoredBase): void {
    this.base.save(base);
  }

  private emptyManifest(): VaultManifest {
    return { vaultId: this.vaultId, files: [] };
  }
}
