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

import crypto from "node:crypto";

import type { VaultManager } from "@repo/vault/vault";
import { getSyncAccount, resetSyncAccount, SyncAccount } from "./sync-account";
import { DeviceIdentity } from "./device-identity";
import { fetchDeviceRoster, postEnrollOffer, postRevoke, type DeviceApi } from "./device-client";
import { createNodeHasher, createSyncManager, createVaultSyncIo } from "./sync-manager";
import { createHttpSyncPort } from "@repo/notes/sync/http-sync-port";
import { isConflictCopyPath } from "@repo/notes/sync/reconcile";
import { statusFromOutcome, type SyncStatus } from "@repo/notes/sync/status";
import {
  base64UrlEncode,
  DEVICE_ASSERTION_VERSION,
  formatPairingBlob,
  MIN_ENROLL_SECRET_BYTES,
} from "@repo/notes/sync/wire";
import type { SyncEngine, SyncOutcome, SyncPassOptions } from "@repo/notes/sync/engine";
import type {
  AccountCapabilities,
  SyncConflict,
  SyncDeviceListResult,
  SyncPairingOfferResult,
  SyncReconnectResult,
  SyncRevokeDeviceResult,
  SyncSignInResult,
  SyncState,
} from "@repo/bridge/sync";
import type { EventMethod, IpcEvent } from "@repo/bridge/ipc-registry";

const DISABLED_REASON = "Enable sync and sign in first.";

const NO_COORDINATOR_REASON = "Set a server URL first.";

/** No device key means the device ROUTES are unreachable: the coordinator
 * admits only device credentials there, by design, so neither identity model
 * reaches into the other. */
const NO_DEVICE_REASON = "This vault is not connected to a device key.";

/** How long a pairing offer stays redeemable. The coordinator clamps to its own
 * maximum and reports what it granted, which is what the UI shows. Short
 * because the blob is a live capability sitting in a clipboard. */
const PAIRING_OFFER_TTL_SECONDS = 10 * 60;

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
  /** Minted PER REQUEST: a device assertion expires in minutes, while the port
   * outlives every pass and the whole SSE stream. The account path answers with
   * its stored bearer. */
  getToken: () => Promise<string>;
  onOutcome: (outcome: SyncOutcome) => void;
}) => SyncEngine;

const defaultEngineFactory: SyncEngineFactory = (opts) =>
  createSyncManager({
    vaultId: opts.vaultId,
    port: createHttpSyncPort({
      baseUrl: opts.coordinatorUrl,
      vaultId: opts.vaultId,
      getToken: opts.getToken,
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
    /** This install's device key. Injected in tests so no suite reads (or
     * mints into) the real ~/.inteligir. */
    private readonly device: DeviceIdentity = new DeviceIdentity(),
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
      device: this.device.current(),
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
   * and emitted, so there is nothing left to do here but return the value.
   *
   * The ONLY path that may carry `confirmDeletions`: every other caller of the
   * engine here (`onVaultChanged`, the periodic timer, the initial kick) is
   * automatic, and an automatic confirmation would defeat the gate. */
  async syncNow(opts?: SyncPassOptions): Promise<SyncOutcome> {
    const engine = this.engine;
    if (!engine) {
      const outcome: SyncOutcome = { status: "error", message: DISABLED_REASON };
      this.status = { phase: "error", message: DISABLED_REASON };
      this.emit();
      return outcome;
    }
    this.status = { phase: "syncing" };
    this.emit();
    return engine.syncOnce(opts);
  }

  // ---- device identity ------------------------------------------------------

  /** The coordinator's roster for this device's vault. */
  async listDevices(): Promise<SyncDeviceListResult> {
    const api = this.deviceApi();
    if (api === null) return { ok: false, error: this.deviceGateReason() };
    const result = await this.callDeviceApi(() => fetchDeviceRoster(api));
    return result.ok ? { ok: true, devices: result.value } : { ok: false, error: result.error };
  }

  /**
   * Mint a pairing offer: CSPRNG bytes, of which the coordinator receives only
   * `sha256hex(...)`, wrapped with the coordinator URL and vaultId into the one
   * blob the joining device pastes. The secret exists here and in that blob and
   * nowhere else — it is deliberately not persisted, so a closed dialog is a
   * cancelled invitation.
   */
  async createPairingOffer(): Promise<SyncPairingOfferResult> {
    const api = this.deviceApi();
    if (api === null) return { ok: false, error: this.deviceGateReason() };
    const secret = crypto.randomBytes(MIN_ENROLL_SECRET_BYTES);
    const enrollId = crypto.createHash("sha256").update(secret).digest("hex");
    const notAfter = Math.floor(Date.now() / 1000) + PAIRING_OFFER_TTL_SECONDS;
    const result = await this.callDeviceApi(() => postEnrollOffer(api, { enrollId, notAfter }));
    if (!result.ok) return { ok: false, error: result.error };
    const blob = formatPairingBlob({
      v: DEVICE_ASSERTION_VERSION,
      url: api.baseUrl,
      vid: api.vaultId,
      s: base64UrlEncode(new Uint8Array(secret)),
    });
    if (blob === null) {
      return { ok: false, error: "Could not build a pairing code for this server URL." };
    }
    return { ok: true, offer: { blob, expiresAt: result.value * 1000 } };
  }

  /** Tombstone ANOTHER device's key. This device leaves through
   * `disconnectVault` instead — the coordinator refuses a last-device revoke,
   * and "I am leaving" is not a thing it can be told. */
  async revokeDevice(publicKey: string): Promise<SyncRevokeDeviceResult> {
    const api = this.deviceApi();
    if (api === null) return { ok: false, reason: "failed", error: this.deviceGateReason() };
    const result = await this.callDeviceApi(() => postRevoke(api, publicKey));
    if (!result.ok) return { ok: false, reason: "failed", error: result.error };
    if (result.value.ok) return { ok: true };
    return result.value.reason === "last-device"
      ? {
          ok: false,
          reason: "last-device",
          error:
            "This is the vault's last live device. Removing it would leave the copy on the " +
            "server unreachable forever — disconnect this vault instead.",
        }
      : { ok: false, reason: "not-found", error: "That device is no longer on the roster." };
  }

  /**
   * Found a device-owned vault and point sync at it. The remote is FRESH: the
   * first pass sees an empty manifest and plans pushes only, so the whole vault
   * uploads and nothing is deleted anywhere. The account session and its
   * vaultId are left untouched underneath, which is what makes this reversible
   * — `disconnectVault` puts the install back on them.
   */
  reconnectVault(): SyncReconnectResult {
    if (this.account.getConfig().coordinatorUrl.trim() === "") {
      return { ok: false, error: NO_COORDINATOR_REASON };
    }
    const existing = this.device.current();
    if (existing !== null) return { ok: true, device: existing };
    let device: ReturnType<DeviceIdentity["found"]>;
    try {
      device = this.device.found();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Could not create a key." };
    }
    this.account.setConfig({ enabled: true });
    this.rebuild({ kickInitial: true });
    this.emit();
    return { ok: true, device };
  }

  /**
   * Stop syncing this vault from this device: forget the key, turn sync off.
   * Purely local by design — see `DeviceIdentity.forget`. Vault files are not
   * touched, here or on the server.
   */
  disconnectVault(): SyncState {
    this.device.forget();
    this.account.setConfig({ enabled: false });
    this.rebuild({ kickInitial: false });
    this.status = { phase: "idle" };
    this.emit();
    return this.getState();
  }

  /** Stop the engine (shutdown). Leaves persisted config/session intact. */
  dispose(): void {
    this.teardownEngine();
    this.device.close();
  }

  // ---- internals ------------------------------------------------------------

  /** Why the device routes are unreachable — the two states differ in remedy. */
  private deviceGateReason(): string {
    return this.device.current() === null ? NO_DEVICE_REASON : NO_COORDINATOR_REASON;
  }

  /** Run a device-route call, turning a minting failure (an unreadable key)
   * into the same `{ok:false}` shape a transport failure takes: both are
   * "this device cannot talk to its vault right now", and only the message
   * differs. */
  private async callDeviceApi<T>(
    call: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>,
  ): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    try {
      return await call();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "The request failed." };
    }
  }

  /**
   * Which vault this device syncs and how it proves itself. The device key
   * WINS when one exists: reconnecting is the deliberate act that moves this
   * install onto the device model, and the account credential is left in place
   * underneath it so disconnecting restores exactly what was there before.
   */
  private credential(): { vaultId: string; getToken: () => Promise<string> } | null {
    const device = this.device.current();
    if (device !== null) {
      return {
        vaultId: device.vaultId,
        getToken: () => Promise.resolve(this.device.mintAssertion(device.vaultId)),
      };
    }
    const token = this.account.getToken();
    if (token === null) return null;
    return { vaultId: this.account.getVaultId(), getToken: () => Promise.resolve(token) };
  }

  /** The device-route client for this vault, or null when this install has no
   * device key (the account credential is not admitted on those routes). */
  private deviceApi(): DeviceApi | null {
    const device = this.device.current();
    const { coordinatorUrl } = this.account.getConfig();
    if (device === null || coordinatorUrl.trim() === "") return null;
    return {
      baseUrl: coordinatorUrl.trim(),
      vaultId: device.vaultId,
      getToken: () => Promise.resolve(this.device.mintAssertion(device.vaultId)),
    };
  }

  private rebuild(opts: { kickInitial: boolean }): void {
    this.teardownEngine();
    const config = this.account.getConfig();
    const credential = this.credential();
    if (!config.enabled || credential === null || config.coordinatorUrl.trim() === "") return;
    const { vaultId } = credential;
    // `onOutcome` fires for EVERY pass this engine runs — explicit (syncNow,
    // the initial kick below) AND debounced (onVaultChanged, the remote
    // subscription, the periodic timer) — so a background pass's conflicts
    // surface exactly as promptly as an explicit one's. Guarded against a
    // newer rebuild having already replaced `this.engine` (a stale pass
    // completing after teardown must not resurrect old status).
    const engine = this.buildEngine({
      vaultId,
      coordinatorUrl: config.coordinatorUrl,
      getToken: credential.getToken,
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
