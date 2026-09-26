// the credential file is the switch: no second "enabled" flag, because two
// values that must agree can disagree. a pass is single-flight and coalescing —
// two concurrent drains push one batch twice. the socket is latency, never correctness.

import { createCloudClient, describeCloudFailure } from "@repo/api/cloud/client";
import type {
  CloudClient,
  CloudEndpoint,
  CloudFailure,
  CloudFetch,
  CloudResult,
  CloudSocketOpener,
  CreateCloudClientArgs,
} from "@repo/api/cloud/client";
import { normalizeDeviceName } from "@repo/api/cloud/device/device-schema";
import { loginDevice, signUpDevice } from "@repo/api/cloud/device/login-flow";
import type {
  DeviceCredentialStore,
  LoginOutcome as DeviceLoginOutcome,
} from "@repo/api/cloud/device/login-flow";
import { SYNC_TERMINAL_CODES } from "@repo/api/cloud/errors";
import { createSocketLink } from "@repo/api/cloud/sync/socket-link";
import { createSingleFlight, createSyncSession } from "@repo/api/cloud/sync/sync-session";
import type { SyncOutcome } from "@repo/api/cloud/sync/sync-session";
import type { DbConnection, DbTransaction } from "@repo/db/connection";
import {
  countSyncOutbox,
  ownDeviceIds,
  readSyncState,
  recordOwnDevice,
  resetSyncState,
  takeRewindIfBuildChanged,
} from "@repo/db/sync-outbox";
import type { ThreadEvent } from "@repo/domain/provider-event";
import type {
  CloudDevicesResponse,
  CloudLoginRequest,
  CloudRevokeDeviceResponse,
  CloudSignUpRequest,
  CloudStatusResponse,
} from "@repo/api/local/cloud/cloud-schema";
import type { DebugLog } from "../debug-log";
import { messageOf } from "../error-message";
import type { CaptureVault } from "./captures";
import {
  clearDeviceCredential,
  readDeviceCredential,
  writeDeviceCredential,
} from "./credential-store";
import type { DeviceCredential } from "./credential-store";
import { enqueueThreadEvents } from "./outbox";
import { createSyncCadence } from "./sync-cadence";
import type { SyncCadenceArgs } from "./sync-cadence";
import { runSyncPass } from "./sync-pass";
import type { PassContext, SyncedEventSink, SyncPassDeps } from "./sync-pass";

// a shutdown's wait for a sign-out in flight: the client's own deadline is 30s, far past the
// cloud teardown step's budget, and a quit that overran it would exit non-zero.
const SIGN_OUT_GRACE_MS = 3000;

export interface CloudTransport {
  fetch?: CloudFetch;
  /** absent means poll-only. injected rather than defaulted because node's dial
   *  cannot be typed here (browser tsconfig). */
  openSocket?: CloudSocketOpener;
  /** null disables the poll timer and the push debounce. */
  pollIntervalMs?: number | null;
}

export interface CloudRuntimeArgs {
  db: DbConnection;
  dataDir: string;
  cloudUrl: string;
  /** the running build's version: a log row one build could not read is pulled again by the next. */
  build: string;
  /** the name a sign-in that names none gives this device (`readMachineName`). */
  machineName: string;
  vault: CaptureVault;
  transport?: CloudTransport;
  /** the vault ping's handler; also kicked once after a login so the derived remote syncs now. */
  onVaultPing?: () => void;
  /** what status() answers moved: a sign-in or out, a revocation, the identity, the socket, a
   *  pass's end. never per enqueue: the queued count rides the drain pass that follows it. */
  onStatusChanged?: () => void;
  onDebug?: (message: string) => void;
  /** INTELIGIR_DEBUG's sync trace, beside onDebug's always-on warnings. */
  debugLog?: DebugLog | undefined;
  /** read per pass: whether this Mac takes a phone's requests. absent, it does, as it ships. */
  phoneRequests?: () => boolean;
}

export type LoginOutcome =
  | { kind: "logged-in"; status: CloudStatusResponse }
  | Extract<DeviceLoginOutcome, { kind: "refused" }>;

// a call a person asks of the account over this device's live sign-in. `not-live`: none to ask
// with, or the cloud refused its credential just now, which ends the session as a pass's refusal would
type AccountCallOutcome<TValue> =
  | { kind: "answered"; value: TValue }
  | { kind: "not-live"; message: string }
  | { kind: "failed"; failure: CloudFailure };

type RevokeDeviceOutcome = AccountCallOutcome<CloudRevokeDeviceResponse> | { kind: "this-device" };

const NOT_SIGNED_IN = "This Mac isn't signed in to an account.";
const SIGNED_OUT_BY_ACCOUNT = "This Mac was signed out of your account.";
const SIGN_IN_CHANGED = "This Mac's sign-in changed while that was asked. Try again.";
const SHUTTING_DOWN: CloudFailure = { kind: "unreachable", message: "This app is shutting down." };

export interface CloudRuntime {
  status: () => CloudStatusResponse;
  enqueue: (tx: DbTransaction, events: readonly ThreadEvent[]) => void;
  /** an approval opened or settled here: a phone-started turn's is offered or taken back soon. */
  approvalsChanged: () => void;
  /** whether this Mac takes a phone's requests moved; its socket says so only when it dials. */
  phoneRequestsChanged: () => void;
  /** late-bound: the thread service needs enqueue at construction. */
  attach: (sink: SyncedEventSink) => void;
  start: () => void;
  login: (request: CloudLoginRequest) => Promise<LoginOutcome>;
  /** creates the account and keeps its first credential, exactly as login keeps one. */
  signUp: (request: CloudSignUpRequest) => Promise<LoginOutcome>;
  logout: () => CloudStatusResponse;
  /** the account's devices still signed in, this one marked current. */
  devices: () => Promise<AccountCallOutcome<CloudDevicesResponse>>;
  /** cuts another of the account's devices off; this one signs out instead. */
  revokeDevice: (deviceId: string) => Promise<RevokeDeviceOutcome>;
  /** ends the account and forgets this device's sign-in; the vault is left as it is. */
  deleteAccount: (password: string) => Promise<AccountCallOutcome<CloudStatusResponse>>;
  syncNow: () => Promise<CloudStatusResponse>;
  dispose: () => Promise<void>;
}

export const createCloudRuntime = (args: CloudRuntimeArgs): CloudRuntime => {
  const transport = args.transport ?? {};
  const debug =
    args.onDebug ??
    ((message: string) => {
      console.error(`cloud: ${message}`);
    });

  let sink: SyncedEventSink | null = null;
  let lastError: string | null = null;
  let revokeError: string | null = null;
  let disposed = false;
  const flight = createSingleFlight();
  // best-effort; a failure costs the label, never the sync.
  let accountEmail: string | null = null;
  // keyed by session: joining the previous login's fetch answers about an account this device left.
  let learningIdentity: { sessionId: number; pass: Promise<void> } | null = null;

  const notifyStatus = (): void => {
    args.onStatusChanged?.();
  };

  const endpoint = (): CloudEndpoint => {
    const target: CloudEndpoint = { baseUrl: args.cloudUrl };
    if (transport.fetch !== undefined) {
      target.fetch = transport.fetch;
    }
    return target;
  };

  const clientArgs = (credential: string, signal: AbortSignal): CreateCloudClientArgs => ({
    ...endpoint(),
    credential,
    signal,
  });

  const session = createSyncSession<DeviceCredential>({
    debugLog: args.debugLog,
    makeClient: (credential, signal) =>
      createCloudClient(clientArgs(credential.credential, signal)),
    onEnded: (failure) => {
      debug(`credential refused (${failure.code}): ${failure.message}`);
    },
  });

  // settles once every sign-out sent so far has, so a shutdown right after one still gives the
  // slot back; a shutdown aborts whatever is still in flight after SIGN_OUT_GRACE_MS.
  let signOutsSettled: Promise<void> = Promise.resolve();
  const signOutAbort = new AbortController();

  // never awaited by the caller: an unreachable cloud must not hold a sign-out open, and the row it
  // leaves is another device's to revoke, which the signed-out status says. its own client,
  // because closing the session aborts every request the session's client carries.
  const signOutBestEffort = (credential: DeviceCredential): void => {
    const client = createCloudClient(clientArgs(credential.credential, signOutAbort.signal));
    const earlier = signOutsSettled;
    signOutsSettled = (async () => {
      const result = await client.signOut();
      if (!result.ok) {
        const message = describeCloudFailure(result.failure);
        debug(`sign-out did not revoke this device: ${message}`);
        // a credential the cloud refuses is no longer live: no other device has anything to remove.
        const refusedCredential =
          result.failure.kind === "refused" && SYNC_TERMINAL_CODES.has(result.failure.code);
        if (!refusedCredential) {
          revokeError = message;
          notifyStatus();
        }
      }
      await earlier;
    })();
  };

  const sessionAlive = (sessionId: number): boolean => !disposed && session.fenced(sessionId);

  const live = (): boolean => !disposed && session.current().kind === "live";

  const fenced = (context: PassContext): boolean => sessionAlive(context.sessionId);

  // retried at the top of every pass while missing: the credential is written
  // once, so a single dropped answer would leave the vault's fail-closed fence
  // shut for the process's whole life.
  const learnAccountIdentity = async (): Promise<void> => {
    const current = session.current();
    if (current.kind !== "live") {
      return;
    }
    const { client, credential } = current;
    const sessionId = current.id;
    if (learningIdentity?.sessionId === sessionId) {
      await learningIdentity.pass;
      return;
    }
    const pass = (async () => {
      try {
        const result = await client.account();
        // a re-login mid-flight must not label the new session with the old account.
        if (!sessionAlive(sessionId)) {
          return;
        }
        accountEmail = result.ok ? result.value.email : null;
        notifyStatus();
        if (result.ok && credential.userId !== result.value.id) {
          const updated = { ...credential, userId: result.value.id };
          writeDeviceCredential(args.dataDir, updated);
          session.replaceCredential(sessionId, updated);
          args.onVaultPing?.();
        }
      } finally {
        if (learningIdentity?.sessionId === sessionId) {
          learningIdentity = null;
        }
      }
    })();
    learningIdentity = { pass, sessionId };
    await pass;
  };

  const learnAccountIdentityBestEffort = async (): Promise<void> => {
    try {
      await learnAccountIdentity();
    } catch {
      // the next pass retries; the label is the only thing lost.
    }
  };

  // at boot as well as at sign-in: a database migrated under a live credential never saw that
  // sign-in happen, and a pull under it would re-apply everything this install pushed.
  const openSession = (credential: DeviceCredential): void => {
    accountEmail = null;
    recordOwnDevice(args.db, credential.deviceId);
    const replayFrom = takeRewindIfBuildChanged(args.db, args.build);
    if (replayFrom !== null) {
      debug(
        `a different build is running: pulling again from log row ${replayFrom}, which the last one could not read`,
      );
    }
    session.open(credential);
    notifyStatus();
    void learnAccountIdentityBestEffort();
  };

  const stored = readDeviceCredential(args.dataDir);
  if (stored !== null) {
    openSession(stored);
  }

  // the socket and the timer both request a pass, and a pass tears both down on a
  // refusal; the request is bound once the pass exists, before either can fire.
  let requestPass: (() => void) | null = null;

  const phoneRequests = args.phoneRequests ?? (() => true);
  // an unreadable choice is not announced as on: the person may have turned it off
  const announcesPhoneRequests = (): boolean => {
    try {
      return phoneRequests();
    } catch (error) {
      debug(`reading whether this Mac takes phone requests failed: ${messageOf(error)}`);
      return false;
    }
  };

  const link = createSocketLink({
    baseUrl: args.cloudUrl,
    canConnect: live,
    credential: () => {
      const current = session.current();
      return current.kind === "live" ? current.credential.credential : null;
    },
    // this process owns the vault and drives the agent, so a phone's turn is addressed to it
    // while it takes them.
    listener: () => ({ phoneRequests: announcesPhoneRequests(), platform: "desktop" }),
    onPing: (ping) => {
      // pings carry no payload; a sync ping's seq is the log's high-water, so one
      // the cursor covers is skipped. vault is another device's push — the git
      // engine's pass, not this one's.
      if (ping.type === "vault") {
        args.onVaultPing?.();
        return;
      }
      if (ping.type === "sync") {
        const { cursor } = readSyncState(args.db);
        if (ping.seq <= cursor) {
          args.debugLog?.(`sync ping at ${ping.seq} skipped: the cursor ${cursor} covers it`);
          return;
        }
      }
      requestPass?.();
    },
    onConnectionChanged: (connected) => {
      notifyStatus();
      // a ping sent while this socket was not up reached nothing; the pull carries what it announced.
      if (connected) {
        requestPass?.();
      }
    },
    onSevered: () => {
      // a hint; only an http refusal is authoritative.
      requestPass?.();
    },
    openSocket: transport.openSocket ?? null,
  });

  const cadenceArgs: SyncCadenceArgs = {
    canRun: live,
    run: () => {
      requestPass?.();
    },
  };
  if (transport.pollIntervalMs !== undefined) {
    cadenceArgs.pollIntervalMs = transport.pollIntervalMs;
  }
  const cadence = createSyncCadence(cadenceArgs);

  const haltTransport = (): void => {
    link.close();
    cadence.clear();
  };

  // the session ends only through here, so its end and the transport's teardown stay one event.
  const recordFailure = (failure: CloudFailure): "continue" | "ended" => {
    lastError = describeCloudFailure(failure);
    const outcome = session.recordFailure(failure);
    if (outcome === "ended") {
      haltTransport();
      notifyStatus();
    } else {
      debug(lastError);
    }
    return outcome;
  };

  // over the session's own client, fenced like a pass: an answer that lands after a sign-out or a
  // sign-in may speak for an account this device has left, and only a terminal refusal reaches
  // recordFailure, since any other is this call's alone and not the sync's last error
  const accountCall = async <TValue>(
    call: (live: {
      client: CloudClient;
      credential: DeviceCredential;
    }) => Promise<CloudResult<TValue>>,
  ): Promise<AccountCallOutcome<TValue>> => {
    const current = session.current();
    if (disposed || current.kind !== "live") {
      return { kind: "not-live", message: NOT_SIGNED_IN };
    }
    const result = await call(current);
    if (!sessionAlive(current.id)) {
      return { kind: "not-live", message: SIGN_IN_CHANGED };
    }
    if (result.ok) {
      return { kind: "answered", value: result.value };
    }
    const { failure } = result;
    if (failure.kind === "refused" && SYNC_TERMINAL_CODES.has(failure.code)) {
      recordFailure(failure);
      return { kind: "not-live", message: SIGNED_OUT_BY_ACCOUNT };
    }
    return { failure, kind: "failed" };
  };

  const passDeps: SyncPassDeps = {
    build: args.build,
    db: args.db,
    debug,
    debugLog: args.debugLog,
    fenced,
    phoneRequests,
    recordFailure,
    setLastError: (message) => {
      lastError = message;
    },
    sink: () => sink,
    vault: args.vault,
  };

  const runPass = async (): Promise<SyncOutcome> => {
    const current = session.current();
    if (current.kind !== "live" || disposed) {
      return "fenced";
    }
    // captured once; every step re-checks it rather than re-reading the session.
    const context: PassContext = {
      client: current.client,
      ownDeviceIds: ownDeviceIds(args.db),
      sessionId: current.id,
    };
    if (current.credential.userId === undefined) {
      // a no-op once learned; the poll is the retry cadence for this one fetch.
      await learnAccountIdentity();
      if (!fenced(context)) {
        return "fenced";
      }
    }
    const outcome = await runSyncPass(passDeps, context);
    args.debugLog?.(`session ${context.sessionId} pass: ${outcome}`);
    notifyStatus();
    return outcome;
  };

  const status = (): CloudStatusResponse => {
    const current = session.current();
    switch (current.kind) {
      case "off": {
        return { cloudUrl: args.cloudUrl, revokeError, state: "signed-out" };
      }
      case "unauthorized": {
        return {
          cloudUrl: args.cloudUrl,
          detail: current.detail,
          deviceId: current.credential.deviceId,
          state: "unauthorized",
        };
      }
      case "live": {
        const state = readSyncState(args.db);
        return {
          accountEmail,
          cloudUrl: args.cloudUrl,
          connected: link.isConnected(),
          cursor: state.cursor,
          deviceId: current.credential.deviceId,
          dropped: state.droppedEvents,
          lastError,
          lastSyncedAt: state.lastSyncedAt,
          pending: countSyncOutbox(args.db),
          state: "signed-in",
        };
      }
      default: {
        const exhaustive: never = current;
        return exhaustive;
      }
    }
  };

  const syncNow = async (): Promise<CloudStatusResponse> => {
    if (!live()) {
      return status();
    }
    await flight.run({
      onError: (message) => {
        lastError = message;
        debug(`sync pass failed: ${message}`);
        notifyStatus();
      },
      pass: runPass,
      repeat: live,
    });
    return status();
  };

  requestPass = (): void => {
    void syncNow();
  };

  const adoptCredential = async (credential: DeviceCredential): Promise<void> => {
    if (disposed) {
      // teardown ran during the login round trip: write nothing after it.
      throw new Error("This app is shutting down; the credential was not kept.");
    }
    const previous = session.current();
    // clean slate: the outbox and both positions describe an account this device
    // may have left. openSession ends the old session, which stops a running pass
    // from acking into the emptied queue.
    haltTransport();
    resetSyncState(args.db);
    writeDeviceCredential(args.dataDir, credential);
    revokeError = null;
    openSession(credential);
    // only once the new credential is kept: a failed write leaves the previous one this device's key
    if (previous.kind === "live") {
      signOutBestEffort(previous.credential);
    }
    lastError = null;
    link.resetBackoff();
    cadence.armPoll();
    link.connect();
    await syncNow();
    // the login just derived a hosted remote; sync it now.
    args.onVaultPing?.();
  };

  const forgetSignIn = (): CloudStatusResponse => {
    session.close();
    haltTransport();
    clearDeviceCredential(args.dataDir);
    resetSyncState(args.db);
    lastError = null;
    link.resetBackoff();
    notifyStatus();
    return status();
  };

  // its own client, as a sign-out's: the deletion revokes this very credential first, and a pass
  // that meets it ends the session, which aborts every request the session's client carries
  const deleteAbort = new AbortController();

  const deleteAccount = async (
    password: string,
  ): Promise<AccountCallOutcome<CloudStatusResponse>> => {
    const asked = session.current();
    if (disposed || asked.kind !== "live") {
      return { kind: "not-live", message: NOT_SIGNED_IN };
    }
    const client = createCloudClient(clientArgs(asked.credential.credential, deleteAbort.signal));
    const result = await client.deleteAccount(password);
    if (disposed) {
      return { failure: SHUTTING_DOWN, kind: "failed" };
    }
    const now = session.current();
    // live still, or refused since by a pass that met the deletion's own revocation
    const sameSignIn =
      now.kind !== "off" && now.credential.credential === asked.credential.credential;
    if (result.ok) {
      if (!sameSignIn) {
        return { kind: "answered", value: status() };
      }
      // no sign-out: every device row went with the account, so none is left to revoke
      revokeError = null;
      return { kind: "answered", value: forgetSignIn() };
    }
    if (!sessionAlive(asked.id)) {
      return { kind: "not-live", message: sameSignIn ? SIGNED_OUT_BY_ACCOUNT : SIGN_IN_CHANGED };
    }
    const { failure } = result;
    if (failure.kind === "refused" && SYNC_TERMINAL_CODES.has(failure.code)) {
      recordFailure(failure);
      return { kind: "not-live", message: SIGNED_OUT_BY_ACCOUNT };
    }
    return { failure, kind: "failed" };
  };

  // login and sign-up both end in a credential this device adopts, through the one store, which
  // keeps the name it joined under: the vault's commits carry it.
  const joinAccount = async (
    requestedName: string | undefined,
    join: (store: DeviceCredentialStore, deviceName: string) => Promise<DeviceLoginOutcome>,
  ): Promise<LoginOutcome> => {
    if (disposed) {
      return { failure: SHUTTING_DOWN, kind: "refused" };
    }
    const deviceName = normalizeDeviceName(requestedName ?? args.machineName);
    const outcome = await join(
      {
        write: async (credential) => {
          await adoptCredential({ ...credential, deviceName });
        },
      },
      deviceName,
    );
    return outcome.kind === "logged-in" ? { kind: "logged-in", status: status() } : outcome;
  };

  return {
    approvalsChanged() {
      cadence.scheduleDrain();
    },

    attach(next) {
      sink = next;
    },

    deleteAccount,

    async devices() {
      return await accountCall(async ({ client, credential }) => {
        const result = await client.listDevices();
        if (!result.ok) {
          return result;
        }
        const devices = result.value.devices.flatMap((device) =>
          device.revokedAt === null
            ? [
                {
                  createdAt: device.createdAt,
                  current: device.id === credential.deviceId,
                  id: device.id,
                  lastSeenAt: device.lastSeenAt,
                  name: device.name,
                },
              ]
            : [],
        );
        return { ok: true, value: { devices } };
      });
    },

    async dispose() {
      disposed = true;
      haltTransport();
      deleteAbort.abort();
      // without the abort the teardown budget is a hope: the pass would wait out
      // every round trip and keep writing.
      session.abort();
      // let a pass mid-flight finish so the outbox's ack and its push agree.
      const inflight = flight.inflight();
      if (inflight !== null) {
        try {
          await inflight;
        } catch {
          // the pass reported through onError; the teardown has nothing to add.
        }
      }
      const grace = setTimeout(() => {
        signOutAbort.abort();
      }, SIGN_OUT_GRACE_MS);
      grace.unref?.();
      try {
        await signOutsSettled;
      } finally {
        clearTimeout(grace);
      }
    },

    enqueue(tx, events) {
      if (session.current().kind !== "live" || events.length === 0) {
        // a signed-out install queues nothing: signing in later syncs from that
        // moment, not a backlog no other device has a base for.
        return;
      }
      enqueueThreadEvents(tx, events);
      cadence.scheduleDrain();
    },

    phoneRequestsChanged() {
      if (!live()) {
        return;
      }
      link.close();
      notifyStatus();
      link.resetBackoff();
      link.connect();
    },

    async login(request) {
      return await joinAccount(
        request.deviceName,
        async (store, deviceName) =>
          await loginDevice({
            client: endpoint(),
            deviceName,
            email: request.email,
            password: request.password,
            store,
          }),
      );
    },

    logout() {
      // an unauthorized credential is one the cloud already refused: nothing is left to revoke
      const current = session.current();
      if (current.kind === "live") {
        signOutBestEffort(current.credential);
      }
      return forgetSignIn();
    },

    async revokeDevice(deviceId) {
      // refused before any request: this device leaves through a sign-out, which also forgets its
      // credential and its queue, where a revoke would leave both behind, refused
      const current = session.current();
      if (current.kind !== "off" && current.credential.deviceId === deviceId) {
        return { kind: "this-device" };
      }
      return await accountCall(async ({ client }) => await client.revokeDevice(deviceId));
    },

    async signUp(request) {
      return await joinAccount(
        request.deviceName,
        async (store, deviceName) =>
          await signUpDevice({
            client: endpoint(),
            deviceName,
            email: request.email,
            inviteCode: request.inviteCode,
            name: request.name,
            password: request.password,
            store,
          }),
      );
    },

    start() {
      if (session.current().kind !== "live") {
        return;
      }
      cadence.armPoll();
      link.connect();
      void syncNow();
    },

    status,

    syncNow,
  };
};
