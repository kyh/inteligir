// ---------------------------------------------------------------------------
// SyncCoordinator — the live lifecycle around the vault-sync engine. It reads
// the runtime gate (SyncAccount's config + bearer token) and builds, starts,
// rebuilds, or tears down a `SyncEngine` accordingly:
//   - enabled + signed in  → construct the HttpSyncPort + engine, start remote
//                            subscription, kick an initial reconcile
//   - toggled off / signed out → stop + drop the engine
// A single wrapper in create-host routes every local vault change into
// `onVaultChanged`, which forwards to whatever engine currently exists (or
// no-ops) — so the wrapper is installed once and survives engine rebuilds.
//
// Every config/auth/status change fires `onSyncStateChanged` over the typed
// event bus, keeping the settings UI reactive without polling.
// ---------------------------------------------------------------------------

import type { VaultManager } from "@repo/vault/vault";
import { getSyncAccount, resetSyncAccount, SyncAccount } from "./sync-account";
import { createNodeHasher, createSyncManager, createVaultSyncIo } from "./sync-manager";
import { createHttpSyncPort } from "@repo/notes/sync/http-sync-port";
import { isConflictCopyPath } from "@repo/notes/sync/reconcile";
import { statusFromOutcome, type SyncStatus } from "@repo/notes/sync/status";
import type { SyncEngine, SyncOutcome } from "@repo/notes/sync/engine";
import type {
  AccountCapabilities,
  SyncConflict,
  SyncSignInResult,
  SyncState,
} from "@repo/bridge/sync";
import type { EventMethod, IpcEvent } from "@repo/bridge/ipc-registry";

const DISABLED_REASON = "Enable sync and sign in first.";

/** Registry-typed event emission, injected by the composing host (sync/ sits
 * below the server, so it never imports the host event bus). */
export type SyncEventSink = <K extends EventMethod>(method: K, payload: IpcEvent<K>) => void;

// Defaults to a drop — exactly the host event bus's behavior with no
// transport subscribed — so the coordinator stays constructible without the
// host composition (tests). createHost installs the real emit before start().
// Module-scoped so it survives resetSyncCoordinator() on a logout/login cycle.
let emitHostEvent: SyncEventSink = () => {};

/** Install the host event emission once at composition time (createHost
 * passes the typed emitEvent). */
export function setSyncEventSink(sink: SyncEventSink): void {
  emitHostEvent = sink;
}

// The live vault, INJECTED by the composition root — sync never reaches for
// the @repo/vault singleton itself (the package dep stays for the TYPE
// only). An accessor rather than an instance because the vault singleton
// rebuilds on a logout/login cycle. Uninstalled (bare test processes), it
// throws — both listing call sites (seedConflicts/pruneConflicts) already
// degrade gracefully on a listing failure, and the engine factory only runs
// once boot has composed the host. Module-scoped so it survives
// resetSyncCoordinator(), mirroring the event sink above.
let vaultAccessor: () => VaultManager = () => {
  throw new Error("sync: vault accessor not installed (createHost injects it at composition)");
};

/** Install the live VaultManager accessor once at composition time (createHost
 * passes @repo/vault's getVaultManager). */
export function setSyncVaultAccessor(accessor: () => VaultManager): void {
  vaultAccessor = accessor;
}

// Periodic reconcile cadence while sync is live (vault liveness — CLAUDE.md
// § Decisions): with no recursive
// watcher, a peer's remote push already wakes us through the remote-change
// subscription, but this interval is the backstop that also flushes local
// edits made between focus events. Policy, not law — revisit with real usage.
const SYNC_INTERVAL_MS = 5 * 60_000;

/** Builds the live engine for one `rebuild()`. `onOutcome` is wired to fire
 * for EVERY pass (explicit or debounced) — see `SyncEngineOptions.onOutcome`.
 * Overridable in tests so a debounced pass can be driven against an
 * in-memory port/vault instead of a real `HttpSyncPort`. */
export type SyncEngineFactory = (opts: {
  vaultId: string;
  coordinatorUrl: string;
  token: string;
  onOutcome: (outcome: SyncOutcome) => void;
}) => SyncEngine;

const defaultEngineFactory: SyncEngineFactory = (opts) =>
  createSyncManager({
    vaultId: opts.vaultId,
    port: createHttpSyncPort({
      baseUrl: opts.coordinatorUrl,
      vaultId: opts.vaultId,
      token: opts.token,
      hasher: createNodeHasher(),
    }),
    vault: createVaultSyncIo(vaultAccessor()),
    onOutcome: opts.onOutcome,
  });

export class SyncCoordinator {
  private engine: SyncEngine | null = null;
  private status: SyncStatus = { phase: "idle" };
  private started = false;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  // Unresolved conflict copies (derived, never persisted): seeded from a vault
  // scan on start, appended from each pass's conflictPaths, and pruned against
  // the live listing on every state read — deleting the copy resolves the row.
  private conflicts: SyncConflict[] = [];

  constructor(
    private readonly account: SyncAccount,
    /** Vault-relative paths of every vault file — injected so tests never touch
     * a live vault. Only consulted once conflicts exist (or at start()). The
     * default reads through the composition-installed vault accessor. */
    private readonly listVaultPaths: () => readonly string[] = () => vaultAccessor().listAllPaths(),
    /** Builds the live engine — injected so tests can drive a debounced pass
     * against an in-memory port instead of a real network transport. */
    private readonly buildEngine: SyncEngineFactory = defaultEngineFactory,
  ) {}

  /** Build + start the engine if enabled and authed. Call after the vault is
   * ready (createSyncManager reads live vault files). Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.seedConflicts();
    this.rebuild({ kickInitial: true });
  }

  /** A local vault file changed — nudge the running engine (debounced there).
   * No-op when sync is off. */
  onVaultChanged(): void {
    this.engine?.scheduleSync();
  }

  getState(): SyncState {
    this.pruneConflicts();
    const config = this.account.getConfig();
    return {
      enabled: config.enabled,
      signedIn: this.account.getToken() !== null,
      email: this.account.getEmail(),
      coordinatorUrl: config.coordinatorUrl,
      status: this.status,
      conflicts: [...this.conflicts],
    };
  }

  setConfig(patch: { enabled?: boolean; coordinatorUrl?: string }): SyncState {
    this.account.setConfig(patch);
    // A config change may enable/disable or repoint sync — rebuild against the
    // new gate; kick an initial reconcile only if we end up with a live engine.
    this.rebuild({ kickInitial: true });
    this.emit();
    return this.getState();
  }

  async signIn(email: string, password: string): Promise<SyncSignInResult> {
    const result = await this.account.signIn(email, password);
    if (result.ok) this.rebuild({ kickInitial: true });
    this.emit();
    return result;
  }

  /** Guest→account upgrade: a successful sign-up signs straight in, and the
   * rebuild adopts the EXISTING local vault (reconcile pushes it; nothing is
   * wiped — the vault on disk stays canonical). */
  async signUp(email: string, password: string): Promise<SyncSignInResult> {
    const result = await this.account.signUp(email, password);
    if (result.ok) this.rebuild({ kickInitial: true });
    this.emit();
    return result;
  }

  /** Social OAuth INITIATION — opens the system browser; auth state does not
   * change here. The `inteligir://session` deep link completes the round-trip
   * through `completeSocialSignIn`. */
  async socialSignIn(provider: string): Promise<SyncSignInResult> {
    return this.account.socialSignIn(provider);
  }

  /** Password-reset request — pure passthrough (no auth state changes until
   * the user signs in with the new password). Neutral result by contract. */
  async requestPasswordReset(email: string): Promise<SyncSignInResult> {
    return this.account.requestPasswordReset(email);
  }

  /** Social sign-in COMPLETION — the deep-link service routes the session
   * verb's code+state here. Deep-link-driven, not request/response, so the
   * outcome reaches the account UI as the `onSocialSignInResult` event (plus
   * the usual state emit); a success rebuilds the engine exactly like the
   * email sign-in path. */
  async completeSocialSignIn(code: string, state: string): Promise<SyncSignInResult> {
    const result = await this.account.completeSocialSignIn(code, state);
    if (result.ok) this.rebuild({ kickInitial: true });
    this.emit();
    emitHostEvent("onSocialSignInResult", result);
    return result;
  }

  getCapabilities(): Promise<AccountCapabilities> {
    return this.account.getCapabilities();
  }

  async signOut(): Promise<void> {
    await this.account.signOut();
    this.teardownEngine();
    this.status = { phase: "idle" };
    this.emit();
  }

  /** Kick an explicit pass. Its outcome lands through the SAME `onOutcome`
   * path a debounced pass uses (wired in `rebuild()`) — by the time this
   * `await` resolves, `handleOutcome` has already updated status/conflicts
   * and emitted, so there is nothing left to do here but return the value. */
  async syncNow(): Promise<SyncOutcome> {
    const engine = this.engine;
    if (!engine) {
      const outcome: SyncOutcome = { status: "error", message: DISABLED_REASON };
      this.status = { phase: "error", message: DISABLED_REASON };
      this.emit();
      return outcome;
    }
    this.status = { phase: "syncing" };
    this.emit();
    return engine.syncOnce();
  }

  /** Stop the engine (shutdown). Leaves persisted config/session intact. */
  dispose(): void {
    this.teardownEngine();
  }

  // ---- internals ------------------------------------------------------------

  private rebuild(opts: { kickInitial: boolean }): void {
    this.teardownEngine();
    const config = this.account.getConfig();
    const token = this.account.getToken();
    if (!config.enabled || token === null || config.coordinatorUrl.trim() === "") return;
    const vaultId = this.account.getVaultId();
    // `onOutcome` fires for EVERY pass this engine runs — explicit (syncNow,
    // the initial kick below) AND debounced (onVaultChanged, the remote
    // subscription, the periodic timer) — so a background pass's conflicts
    // surface exactly as promptly as an explicit one's. Guarded against a
    // newer rebuild having already replaced `this.engine` (a stale pass
    // completing after teardown must not resurrect old status).
    const engine = this.buildEngine({
      vaultId,
      coordinatorUrl: config.coordinatorUrl,
      token,
      onOutcome: (outcome) => {
        if (this.engine !== engine) return;
        this.handleOutcome(outcome);
      },
    });
    engine.start();
    this.engine = engine;
    // Periodic background reconcile while the engine is live — a focus refresh
    // and remote pushes already kick sync; this catches everything in between.
    this.syncTimer = setInterval(() => this.engine?.scheduleSync(), SYNC_INTERVAL_MS);
    if (opts.kickInitial) void this.runInitialSync(engine);
  }

  private async runInitialSync(engine: SyncEngine): Promise<void> {
    // A newer rebuild may have already replaced the engine before this even
    // starts; `onOutcome` (wired in rebuild()) carries the same guard for the
    // completion race.
    if (this.engine !== engine) return;
    this.status = { phase: "syncing" };
    this.emit();
    await engine.syncOnce();
  }

  /** The one place a pass's outcome becomes coordinator state — reached by
   * EVERY pass (explicit or debounced) via the `onOutcome` wired in
   * `rebuild()`. */
  private handleOutcome(outcome: SyncOutcome): void {
    this.recordConflicts(outcome);
    this.status = statusFromOutcome(outcome);
    this.emit();
  }

  /** Adopt pre-existing conflict copies (created before this boot, or pulled
   * from a peer) by scanning the live vault listing. Derive-on-boot — nothing
   * new is persisted; the vault files themselves are the source of truth. */
  private seedConflicts(): void {
    let paths: readonly string[];
    try {
      paths = this.listVaultPaths();
    } catch {
      return; // no vault yet — passes will still record their own conflicts
    }
    const known = new Set(this.conflicts.map((conflict) => conflict.path));
    for (const path of paths) {
      if (!known.has(path) && isConflictCopyPath(path)) {
        this.conflicts.push({ path });
      }
    }
  }

  /** Append this pass's freshly created conflict copies (dedup by path). */
  private recordConflicts(outcome: SyncOutcome): void {
    if (outcome.status !== "ok" || outcome.conflictPaths.length === 0) return;
    const known = new Set(this.conflicts.map((conflict) => conflict.path));
    for (const path of outcome.conflictPaths) {
      if (!known.has(path)) {
        this.conflicts.push({ path });
        known.add(path);
      }
    }
  }

  /** Drop rows whose copy file no longer exists — deleting the copy (from the
   * conflict list, the sidebar, or any peer) IS resolving the conflict. */
  private pruneConflicts(): void {
    if (this.conflicts.length === 0) return;
    let existing: Set<string>;
    try {
      existing = new Set(this.listVaultPaths());
    } catch {
      return; // keep the rows on a transient listing failure
    }
    const kept = this.conflicts.filter((conflict) => existing.has(conflict.path));
    if (kept.length !== this.conflicts.length) this.conflicts = kept;
  }

  private teardownEngine(): void {
    if (this.syncTimer !== null) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    this.engine?.stop();
    this.engine = null;
  }

  private emit(): void {
    emitHostEvent("onSyncStateChanged", this.getState());
  }
}

// ---------------------------------------------------------------------------
// Lazy singleton — mirrors the other host managers.
// ---------------------------------------------------------------------------

let instance: SyncCoordinator | null = null;

export function getSyncCoordinator(): SyncCoordinator {
  if (!instance) instance = new SyncCoordinator(getSyncAccount());
  return instance;
}

export function resetSyncCoordinator(): void {
  instance?.dispose();
  resetSyncAccount();
  instance = null;
}
