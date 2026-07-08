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
// Every config/auth/status change fires `onSyncStateChanged` through the host
// notifier bundle, keeping the settings UI reactive without polling.
// ---------------------------------------------------------------------------

import { getHostNotifiers } from "../host-notifiers";
import { getVaultManager } from "../vault/vault";
import { getSyncAccount, resetSyncAccount, SyncAccount } from "./sync-account";
import { createNodeHasher, createSyncManager } from "./sync-manager";
import { createHttpSyncPort } from "@repo/core/sync/http-sync-port";
import { isConflictCopyPath } from "@repo/core/sync/reconcile";
import type { SyncEngine, SyncOutcome as CoreSyncOutcome } from "@repo/core/sync/engine";
import type {
  SyncConflict,
  SyncOutcome,
  SyncSignInResult,
  SyncState,
  SyncStatus,
} from "@repo/features/sync";

function toStatus(outcome: CoreSyncOutcome): SyncStatus {
  return outcome.status === "ok"
    ? {
        phase: "ok",
        pushed: outcome.pushed,
        pulled: outcome.pulled,
        deleted: outcome.deleted,
        conflicts: outcome.conflicts,
      }
    : { phase: "error", message: outcome.message };
}

const DISABLED_REASON = "Enable sync and sign in first.";

// Periodic reconcile cadence while sync is live (ADR-0001): with no recursive
// watcher, a peer's remote push already wakes us through the remote-change
// subscription, but this interval is the backstop that also flushes local
// edits made between focus events. Policy, not law — revisit with real usage.
const SYNC_INTERVAL_MS = 5 * 60_000;

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
     * a live vault. Only consulted once conflicts exist (or at start()). */
    private readonly listVaultPaths: () => readonly string[] = () =>
      getVaultManager().listAllPaths(),
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
    this.engine?.onVaultChanged();
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

  async signOut(): Promise<void> {
    await this.account.signOut();
    this.teardownEngine();
    this.status = { phase: "idle" };
    this.emit();
  }

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
    const outcome = await engine.syncOnce();
    this.recordConflicts(outcome);
    this.status = toStatus(outcome);
    this.emit();
    return outcome;
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
    const port = createHttpSyncPort({
      baseUrl: config.coordinatorUrl,
      vaultId,
      token,
      hasher: createNodeHasher(),
    });
    const engine = createSyncManager({ vaultId, port });
    engine.start();
    this.engine = engine;
    // Periodic background reconcile while the engine is live — a focus refresh
    // and remote pushes already kick sync; this catches everything in between.
    this.syncTimer = setInterval(() => this.engine?.onVaultChanged(), SYNC_INTERVAL_MS);
    if (opts.kickInitial) void this.runInitialSync(engine);
  }

  private async runInitialSync(engine: SyncEngine): Promise<void> {
    this.status = { phase: "syncing" };
    this.emit();
    const outcome = await engine.syncOnce();
    // A newer rebuild may have replaced the engine mid-flight; only publish this
    // pass's status if it's still the live one.
    if (this.engine !== engine) return;
    this.recordConflicts(outcome);
    this.status = toStatus(outcome);
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
    const detectedAt = new Date().toISOString();
    const known = new Set(this.conflicts.map((conflict) => conflict.path));
    for (const path of paths) {
      if (!known.has(path) && isConflictCopyPath(path)) {
        this.conflicts.push({ path, detectedAt });
      }
    }
  }

  /** Append this pass's freshly created conflict copies (dedup by path). */
  private recordConflicts(outcome: CoreSyncOutcome): void {
    if (outcome.status !== "ok" || outcome.conflictPaths.length === 0) return;
    const detectedAt = new Date().toISOString();
    const known = new Set(this.conflicts.map((conflict) => conflict.path));
    for (const path of outcome.conflictPaths) {
      if (!known.has(path)) {
        this.conflicts.push({ path, detectedAt });
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
    getHostNotifiers()?.syncStateChanged(this.getState());
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
