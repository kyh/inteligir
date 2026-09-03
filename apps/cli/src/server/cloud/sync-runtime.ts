// the credential file is the switch: no second "enabled" flag, because two
// values that must agree can disagree. a pass is single-flight and coalescing —
// two concurrent drains push one batch twice. the socket is latency, never correctness.

import { hostname } from "node:os";
import {
  createCloudClient,
  describeCloudFailure,
  type CloudEndpoint,
  type CloudFailure,
  type CloudFetch,
  type CloudSocketOpener,
  type CreateCloudClientArgs,
} from "@repo/api/cloud/client";
import {
  loginDevice,
  type LoginOutcome as DeviceLoginOutcome,
} from "@repo/api/cloud/device/login-flow";
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
  type DeviceCredential,
} from "./credential-store";
import { enqueueThreadEvents } from "./outbox";
import { createSocketLink } from "./socket-link";
import { createSyncCadence, type SyncCadenceArgs } from "./sync-cadence";
import {
  runSyncPass,
  type PassContext,
  type SyncedEventSink,
  type SyncPassDeps,
} from "./sync-pass";

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
  status(): CloudStatusResponse;
  enqueue(tx: DbTransaction, events: readonly ThreadEvent[]): void;
  /** late-bound: the thread service needs enqueue at construction. */
  attach(sink: SyncedEventSink): void;
  start(): void;
  login(request: CloudLoginRequest): Promise<LoginOutcome>;
  logout(): CloudStatusResponse;
  syncNow(): Promise<CloudStatusResponse>;
  dispose(): Promise<void>;
}

export function createCloudRuntime(args: CloudRuntimeArgs): CloudRuntime {
  const transport = args.transport ?? {};
  const debug = args.onDebug ?? ((message: string) => console.error(`cloud: ${message}`));

  let sink: SyncedEventSink | null = null;
  let lastError: string | null = null;
  let disposed = false;
  const flight = createSingleFlight();
  // best-effort; a failure costs the label, never the sync.
  let accountEmail: string | null = null;
  // keyed by session: joining the previous login's fetch answers about an account this device left.
  let learningIdentity: { sessionId: number; pass: Promise<void> } | null = null;

  function endpoint(): CloudEndpoint {
    const target: CloudEndpoint = { baseUrl: args.cloudUrl };
    if (transport.fetch !== undefined) target.fetch = transport.fetch;
    return target;
  }

  function clientArgs(credential: string, signal: AbortSignal): CreateCloudClientArgs {
    return { ...endpoint(), credential, signal };
  }

  const session = createSyncSession<DeviceCredential>({
    makeClient: (credential, signal) =>
      createCloudClient(clientArgs(credential.credential, signal)),
    onEnded: (failure) => {
      haltTransport();
      debug(`credential refused (${failure.code}): ${failure.message}`);
    },
  });

  function openSession(credential: DeviceCredential): void {
    accountEmail = null;
    session.open(credential);
    void learnAccountIdentity().catch(() => undefined);
  }

  // retried at the top of every pass while missing: the credential is written
  // once, so a single dropped answer would leave the vault's fail-closed fence
  // shut for the process's whole life.
  function learnAccountIdentity(): Promise<void> {
    const current = session.current();
    if (current.kind !== "live") return Promise.resolve();
    const { client, credential } = current;
    const sessionId = current.id;
    if (learningIdentity?.sessionId === sessionId) return learningIdentity.pass;
    const pass = (async () => {
      const result = await client.account();
      // a re-login mid-flight must not label the new session with the old account.
      if (!sessionAlive(sessionId)) return;
      accountEmail = result.ok ? result.value.email : null;
      if (result.ok && credential.userId !== result.value.id) {
        const updated = { ...credential, userId: result.value.id };
        writeDeviceCredential(args.dataDir, updated);
        session.replaceCredential(sessionId, updated);
        args.onVaultPing?.();
      }
    })().finally(() => {
      if (learningIdentity?.sessionId === sessionId) learningIdentity = null;
    });
    learningIdentity = { sessionId, pass };
    return pass;
  }

  function sessionAlive(sessionId: number): boolean {
    return !disposed && session.fenced(sessionId);
  }

  function live(): boolean {
    return !disposed && session.current().kind === "live";
  }

  function fenced(context: PassContext): boolean {
    return sessionAlive(context.sessionId);
  }

  const stored = readDeviceCredential(args.dataDir);
  if (stored !== null) {
    openSession(stored);
  }

  const link = createSocketLink({
    baseUrl: args.cloudUrl,
    openSocket: transport.openSocket ?? null,
    // this process owns the vault and drives the agent, so a desktop-lane dispatch is addressed to it.
    platform: "desktop",
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
      void syncNow();
    },
    onSevered: () => {
      // a hint; only an http refusal is authoritative.
      void syncNow();
    },
  });

  const cadenceArgs: SyncCadenceArgs = {
    canRun: live,
    run: () => {
      void syncNow();
    },
  };
  if (transport.pollIntervalMs !== undefined) cadenceArgs.pollIntervalMs = transport.pollIntervalMs;
  const cadence = createSyncCadence(cadenceArgs);

  function haltTransport(): void {
    link.close();
    cadence.clear();
  }

  function recordFailure(failure: CloudFailure): "continue" | "ended" {
    lastError = describeCloudFailure(failure);
    const outcome = session.recordFailure(failure);
    if (outcome === "continue") debug(lastError);
    return outcome;
  }

  const passDeps: SyncPassDeps = {
    db: args.db,
    vault: args.vault,
    debug,
    sink: () => sink,
    fenced,
    recordFailure,
    setLastError: (message) => {
      lastError = message;
    },
  };

  async function runPass(): Promise<void> {
    const current = session.current();
    if (current.kind !== "live" || disposed) {
      return;
    }
    // captured once; every step re-checks it rather than re-reading the session.
    const context: PassContext = {
      sessionId: current.id,
      client: current.client,
      deviceId: current.credential.deviceId,
    };
    if (current.credential.userId === undefined) {
      // a no-op once learned; the poll is the retry cadence for this one fetch.
      await learnAccountIdentity();
      if (!fenced(context)) {
        return;
      }
    }
    await runSyncPass(passDeps, context);
  }

  function status(): CloudStatusResponse {
    const current = session.current();
    switch (current.kind) {
      case "off":
        return { state: "signed-out", cloudUrl: args.cloudUrl };
      case "unauthorized":
        return {
          state: "unauthorized",
          cloudUrl: args.cloudUrl,
          deviceId: current.credential.deviceId,
          detail: current.detail,
        };
      case "live": {
        const state = readSyncState(args.db);
        return {
          state: "signed-in",
          cloudUrl: args.cloudUrl,
          accountEmail,
          deviceId: current.credential.deviceId,
          connected: link.isConnected(),
          pending: countSyncOutbox(args.db),
          cursor: state.cursor,
          lastSyncedAt: state.lastSyncedAt,
          lastError,
        };
      }
    }
  }

  async function syncNow(): Promise<CloudStatusResponse> {
    if (!live()) {
      return status();
    }
    await flight.run({
      pass: runPass,
      repeat: live,
      onError: (message) => {
        lastError = message;
        debug(`sync pass failed: ${message}`);
      },
    });
    return status();
  }

  async function adoptCredential(credential: DeviceCredential): Promise<void> {
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
  }

  return {
    status,

    enqueue(tx, events) {
      if (session.current().kind !== "live" || events.length === 0) {
        // a signed-out install queues nothing: signing in later syncs from that
        // moment, not a backlog no other device has a base for.
        return;
      }
      enqueueThreadEvents(tx, events);
      cadence.scheduleDrain();
    },

    attach(next) {
      sink = next;
    },

    start() {
      if (session.current().kind !== "live") {
        return;
      }
      cadence.armPoll();
      link.connect();
      void syncNow();
    },

    async login(request) {
      if (disposed) {
        return {
          kind: "refused",
          failure: { kind: "unreachable", message: "This app is shutting down." },
        };
      }
      const outcome = await loginDevice({
        client: endpoint(),
        store: { write: adoptCredential },
        email: request.email,
        password: request.password,
        // raw hostname(): the flow bounds and defaults the name.
        deviceName: request.deviceName ?? hostname(),
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

    syncNow,

    async dispose() {
      disposed = true;
      haltTransport();
      // without the abort the teardown budget is a hope: the pass would wait out
      // every round trip and keep writing.
      session.abort();
      // let a pass mid-flight finish so the outbox's ack and its push agree.
      await flight.inflight()?.catch(() => undefined);
    },
  };
}
