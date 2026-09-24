// the credential file is the switch: no second "enabled" flag, because two
// values that must agree can disagree. a pass is single-flight and coalescing —
// two concurrent drains push one batch twice. the socket is latency, never correctness.

import { hostname } from "node:os";
import { createCloudClient, describeCloudFailure } from "@repo/api/cloud/client";
import type {
  CloudEndpoint,
  CloudFailure,
  CloudFetch,
  CloudSocketOpener,
  CreateCloudClientArgs,
} from "@repo/api/cloud/client";
import { loginDevice } from "@repo/api/cloud/device/login-flow";
import type { LoginOutcome as DeviceLoginOutcome } from "@repo/api/cloud/device/login-flow";
import { SYNC_TERMINAL_CODES } from "@repo/api/cloud/errors";
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
import type { CloudLoginRequest, CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
import type { DebugLog } from "../debug-log";
import type { CaptureVault } from "./captures";
import {
  clearDeviceCredential,
  readDeviceCredential,
  writeDeviceCredential,
} from "./credential-store";
import type { DeviceCredential } from "./credential-store";
import { enqueueThreadEvents } from "./outbox";
import { createSocketLink } from "./socket-link";
import { createSyncCadence } from "./sync-cadence";
import type { SyncCadenceArgs } from "./sync-cadence";
import { runSyncPass } from "./sync-pass";
import type { PassContext, SyncedEventSink, SyncPassDeps } from "./sync-pass";

// a shutdown's wait for a sign-out in flight: the client's own deadline is 30s, far past the
// cloud teardown step's budget, and a quit that overran it would exit non-zero.
const SIGN_OUT_GRACE_MS = 3000;

export interface CloudTransport {
  fetch?: CloudFetch;
  /** absent means poll-only. injected rather than defaulted because
   *  cloud-socket.ts cannot be imported here (browser tsconfig). */
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
}

export type LoginOutcome =
  | { kind: "logged-in"; status: CloudStatusResponse }
  | Extract<DeviceLoginOutcome, { kind: "refused" }>;

export interface CloudRuntime {
  status: () => CloudStatusResponse;
  enqueue: (tx: DbTransaction, events: readonly ThreadEvent[]) => void;
  /** late-bound: the thread service needs enqueue at construction. */
  attach: (sink: SyncedEventSink) => void;
  start: () => void;
  login: (request: CloudLoginRequest) => Promise<LoginOutcome>;
  logout: () => CloudStatusResponse;
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
  // leaves is the Devices page's to revoke, which the signed-out status says. its own client,
  // because closing the session aborts every request the session's client carries.
  const signOutBestEffort = (credential: DeviceCredential): void => {
    const client = createCloudClient(clientArgs(credential.credential, signOutAbort.signal));
    const earlier = signOutsSettled;
    signOutsSettled = (async () => {
      const result = await client.signOut();
      if (!result.ok) {
        const message = describeCloudFailure(result.failure);
        debug(`sign-out did not revoke this device: ${message}`);
        // a credential the cloud refuses is no longer live: the devices page has nothing to remove.
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

  const link = createSocketLink({
    baseUrl: args.cloudUrl,
    canConnect: live,
    credential: () => {
      const current = session.current();
      return current.kind === "live" ? current.credential.credential : null;
    },
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
    // this process owns the vault and drives the agent, so a desktop-lane dispatch is addressed to it.
    platform: "desktop",
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

  const passDeps: SyncPassDeps = {
    build: args.build,
    db: args.db,
    debug,
    debugLog: args.debugLog,
    fenced,
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

  return {
    attach(next) {
      sink = next;
    },

    async dispose() {
      disposed = true;
      haltTransport();
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

    async login(request) {
      if (disposed) {
        return {
          failure: { kind: "unreachable", message: "This app is shutting down." },
          kind: "refused",
        };
      }
      const outcome = await loginDevice({
        client: endpoint(),
        // raw hostname(): the flow bounds and defaults the name.
        deviceName: request.deviceName ?? hostname(),
        email: request.email,
        password: request.password,
        store: { write: adoptCredential },
      });
      return outcome.kind === "logged-in" ? { kind: "logged-in", status: status() } : outcome;
    },

    logout() {
      // an unauthorized credential is one the cloud already refused: nothing is left to revoke
      const current = session.current();
      if (current.kind === "live") {
        signOutBestEffort(current.credential);
      }
      session.close();
      haltTransport();
      clearDeviceCredential(args.dataDir);
      resetSyncState(args.db);
      lastError = null;
      link.resetBackoff();
      notifyStatus();
      return status();
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
