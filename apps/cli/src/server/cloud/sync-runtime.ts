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
import { createSingleFlight, createSyncSession } from "@repo/api/cloud/sync/sync-session";
import type { DbConnection, DbTransaction } from "@repo/db/connection";
import { countSyncOutbox, readSyncState, resetSyncState } from "@repo/db/sync-outbox";
import type { ThreadEvent } from "@repo/domain/provider-event";
import type { CloudLoginRequest, CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
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
  vault: CaptureVault;
  transport?: CloudTransport;
  /** the vault ping's handler; also kicked once after a login so the derived remote syncs now. */
  onVaultPing?: () => void;
  onDebug?: (message: string) => void;
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
  let disposed = false;
  const flight = createSingleFlight();
  // best-effort; a failure costs the label, never the sync.
  let accountEmail: string | null = null;
  // keyed by session: joining the previous login's fetch answers about an account this device left.
  let learningIdentity: { sessionId: number; pass: Promise<void> } | null = null;

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
    makeClient: (credential, signal) =>
      createCloudClient(clientArgs(credential.credential, signal)),
    onEnded: (failure) => {
      debug(`credential refused (${failure.code}): ${failure.message}`);
    },
  });

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

  const openSession = (credential: DeviceCredential): void => {
    accountEmail = null;
    session.open(credential);
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
      if (ping.type === "sync" && ping.seq <= readSyncState(args.db).cursor) {
        return;
      }
      requestPass?.();
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
    } else {
      debug(lastError);
    }
    return outcome;
  };

  const passDeps: SyncPassDeps = {
    db: args.db,
    debug,
    fenced,
    recordFailure,
    setLastError: (message) => {
      lastError = message;
    },
    sink: () => sink,
    vault: args.vault,
  };

  const runPass = async (): Promise<void> => {
    const current = session.current();
    if (current.kind !== "live" || disposed) {
      return;
    }
    // captured once; every step re-checks it rather than re-reading the session.
    const context: PassContext = {
      client: current.client,
      deviceId: current.credential.deviceId,
      sessionId: current.id,
    };
    if (current.credential.userId === undefined) {
      // a no-op once learned; the poll is the retry cadence for this one fetch.
      await learnAccountIdentity();
      if (!fenced(context)) {
        return;
      }
    }
    await runSyncPass(passDeps, context);
  };

  const status = (): CloudStatusResponse => {
    const current = session.current();
    switch (current.kind) {
      case "off": {
        return { cloudUrl: args.cloudUrl, state: "signed-out" };
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
    // clean slate: the outbox and both positions describe an account this device
    // may have left. openSession ends the old session, which stops a running pass
    // from acking into the emptied queue.
    haltTransport();
    resetSyncState(args.db);
    writeDeviceCredential(args.dataDir, credential);
    openSession(credential);
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
      if (inflight === null) {
        return;
      }
      try {
        await inflight;
      } catch {
        // the pass reported through onError; the teardown has nothing to add.
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
      session.close();
      haltTransport();
      clearDeviceCredential(args.dataDir);
      resetSyncState(args.db);
      lastError = null;
      link.resetBackoff();
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
