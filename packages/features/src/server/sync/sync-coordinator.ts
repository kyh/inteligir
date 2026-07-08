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
import { getSyncAccount, resetSyncAccount, SyncAccount } from "./sync-account";
import { createNodeHasher, createSyncManager } from "./sync-manager";
import { createHttpSyncPort } from "@repo/core/sync/http-sync-port";
import type { SyncEngine, SyncOutcome as CoreSyncOutcome } from "@repo/core/sync/engine";
import type { SyncOutcome, SyncSignInResult, SyncState, SyncStatus } from "@repo/features/sync";

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

export class SyncCoordinator {
  private engine: SyncEngine | null = null;
  private status: SyncStatus = { phase: "idle" };
  private started = false;

  constructor(private readonly account: SyncAccount) {}

  /** Build + start the engine if enabled and authed. Call after the vault is
   * ready (createSyncManager reads live vault files). Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.rebuild({ kickInitial: true });
  }

  /** A local vault file changed — nudge the running engine (debounced there).
   * No-op when sync is off. */
  onVaultChanged(): void {
    this.engine?.onVaultChanged();
  }

  getState(): SyncState {
    const config = this.account.getConfig();
    return {
      enabled: config.enabled,
      signedIn: this.account.getToken() !== null,
      email: this.account.getEmail(),
      coordinatorUrl: config.coordinatorUrl,
      status: this.status,
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
    if (opts.kickInitial) void this.runInitialSync(engine);
  }

  private async runInitialSync(engine: SyncEngine): Promise<void> {
    this.status = { phase: "syncing" };
    this.emit();
    const outcome = await engine.syncOnce();
    // A newer rebuild may have replaced the engine mid-flight; only publish this
    // pass's status if it's still the live one.
    if (this.engine !== engine) return;
    this.status = toStatus(outcome);
    this.emit();
  }

  private teardownEngine(): void {
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
