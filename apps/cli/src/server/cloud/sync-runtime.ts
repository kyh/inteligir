// Cloud thread sync: the SESSION — whose account this device syncs as, the
// single-flight pass loop over `sync-pass.ts` on `sync-cadence.ts`'s timers,
// what a socket frame MEANS (`socket-link.ts` owns the dialling), and the
// session side of pairing (`pair-flow.ts` owns the browser dance).
//
// SYNC IS OFF UNTIL SOMEONE PAIRS, and the credential file IS the switch.
// There is no second "enabled" flag, because two values that must agree are
// two values that can disagree — a flag off beside a live credential leaves a
// working credential nothing uses, and a flag on beside none is a promise no
// loop can keep. With no credential this object opens no socket, arms no
// timer and makes no request; `status()` answers `off` and every verb but the
// two halves of pairing is a no-op.
//
// ONE DIRECTION AT A TIME, in one pass, and A PASS IS SINGLE-FLIGHT AND
// COALESCING — a ping that lands mid-pass marks the pass dirty rather than
// starting a second one, because two concurrent drains would push the same
// batch twice and two concurrent pulls would apply the same page twice.
//
// THE SOCKET IS LATENCY, NEVER CORRECTNESS. It carries invalidation pings the
// contract keeps payload-free, so a missed one costs staleness until the next
// timer tick. The reconnect exists for the same reason and gives up on nothing
// — except a credential the cloud has refused, which is the one failure a
// retry cannot fix.

import {
  createCloudClient,
  describeCloudFailure,
  type CloudEndpoint,
  type CloudFailure,
  type CloudFetch,
  type CloudSocketOpener,
  type CreateCloudClientArgs,
} from "@repo/api/cloud/client";
import { createSingleFlight, createSyncSession } from "@repo/api/cloud/sync/sync-session";
import type { DbConnection, DbTransaction } from "@repo/db/connection";
import { countSyncOutbox, readSyncState, resetSyncState } from "@repo/db/sync-outbox";
import type { ThreadEvent } from "@repo/domain/provider-event";
import type {
  CloudPairBeginResponse,
  CloudStatusResponse,
} from "@repo/api/local/cloud/cloud-schema";
import { systemOpenExternalUrl, type OpenExternalUrl } from "./browser-opener";
import type { CaptureVault } from "./captures";
import {
  clearDeviceCredential,
  readDeviceCredential,
  writeDeviceCredential,
  type DeviceCredential,
} from "./credential-store";
import { enqueueThreadEvents } from "./outbox";
import {
  createPairFlow,
  type BeginPairArgs,
  type PairCompletion,
  type PairFlowDeps,
} from "./pair-flow";
import { createSocketLink } from "./socket-link";
import { createSyncCadence, type SyncCadenceArgs } from "./sync-cadence";
import {
  runSyncPass,
  type PassContext,
  type SyncedEventSink,
  type SyncPassDeps,
} from "./sync-pass";

/** The seams a suite replaces to drive this whole runtime without a network.
 *  Absent in production, where every default is the real thing. */
export interface CloudTransport {
  fetch?: CloudFetch;
  /**
   * How the invalidation socket is dialled. ABSENT MEANS POLL-ONLY, which is
   * correct rather than degraded — the socket carries invalidation pings and
   * nothing else, so without it a paired device is exactly one poll interval
   * behind. The shipping boot supplies `cloud-socket.ts`'s opener; that module
   * cannot be reached from here (see its header), which is why this is an
   * injection rather than a default.
   */
  openSocket?: CloudSocketOpener;
  /** null disables the poll timer and the push debounce — what a deterministic
   *  suite needs, and independent of the socket above. */
  pollIntervalMs?: number | null;
}

export interface CloudRuntimeArgs {
  db: DbConnection;
  /** Where the credential lives; also this install's identity. */
  dataDir: string;
  cloudUrl: string;
  /** Where a claimed capture is written. */
  vault: CaptureVault;
  transport?: CloudTransport;
  /** How a pairing sends the user to their browser. Injected so a suite can
   *  drive the whole flow without a window opening on whoever ran it. */
  openExternalUrl?: OpenExternalUrl;
  /** Run a VAULT sync pass — the `vault` ping's handler, and kicked once
   *  after a pairing completes so the newly derived hosted remote syncs
   *  without waiting out the interval. Thread sync stays this runtime's own. */
  onVaultPing?: () => void;
  onDebug?: (message: string) => void;
}

export interface CloudRuntime {
  status(): CloudStatusResponse;
  /** The outbox hook the thread service calls inside its append transaction. */
  enqueue(tx: DbTransaction, events: readonly ThreadEvent[]): void;
  /** Late-bound: the sink is built after this runtime, because the thread
   *  service needs `enqueue` at construction. */
  attach(sink: SyncedEventSink): void;
  start(): void;
  beginPair(args: BeginPairArgs): Promise<CloudPairBeginResponse>;
  completePair(args: { code: string; state: string }): Promise<PairCompletion>;
  unpair(): CloudStatusResponse;
  syncNow(): Promise<CloudStatusResponse>;
  dispose(): Promise<void>;
}

export function createCloudRuntime(args: CloudRuntimeArgs): CloudRuntime {
  const transport = args.transport ?? {};
  const debug = args.onDebug ?? ((message: string) => console.error(`cloud: ${message}`));
  const openExternalUrl = args.openExternalUrl ?? systemOpenExternalUrl;

  let sink: SyncedEventSink | null = null;
  let lastError: string | null = null;
  let disposed = false;
  const flight = createSingleFlight();
  /** Whose account this session syncs as — fetched best-effort when a session
   *  opens, so Settings can name the account rather than a hostname. Null
   *  until the fetch lands (or when a stale cloud has no account row); a
   *  failure costs the label, never the sync. */
  let accountEmail: string | null = null;
  /** The identity fetch in flight, and WHOSE — a pass that arrives while one
   *  is out joins it, but only when it belongs to the same session. Joining
   *  the previous pairing's fetch would answer about an account this device
   *  has left. */
  let learningIdentity: { sessionId: number; pass: Promise<void> } | null = null;

  /** The endpoint every call rides. `fetch` stays ABSENT unless a suite
   *  injected one, so the client falls back to the global. */
  function endpoint(): CloudEndpoint {
    const target: CloudEndpoint = { baseUrl: args.cloudUrl };
    if (transport.fetch !== undefined) target.fetch = transport.fetch;
    return target;
  }

  function clientArgs(credential: string, signal: AbortSignal): CreateCloudClientArgs {
    return { ...endpoint(), credential, signal };
  }

  /** The session machine — the union, the fence and the abort rotation are
   *  the contract's (`@repo/api/cloud/sync/sync-session`); what this runtime
   *  adds around a transition is its own: the socket, the timers and the
   *  account-identity fetch. */
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

  /**
   * Whose account this session syncs as, learned from `/v1/account` and
   * persisted beside the credential — the value the vault's cross-account
   * fence FAILS CLOSED without.
   *
   * SO IT IS RETRIED, at the top of every pass while the id is missing. The
   * fetch is best-effort and one failure is ordinary (a laptop that autostarts
   * before its network is up), but the credential is written once and read
   * forever: a single dropped answer would leave hosted vault sync off for the
   * process's whole life, with nothing said and no error recorded. Learning it
   * re-kicks the vault pass the fence deferred.
   */
  function learnAccountIdentity(): Promise<void> {
    const current = session.current();
    if (current.kind !== "live") return Promise.resolve();
    const { client, credential } = current;
    const sessionId = current.id;
    if (learningIdentity?.sessionId === sessionId) return learningIdentity.pass;
    const pass = (async () => {
      const result = await client.account();
      // The standard fence: a re-pair mid-flight must not label the NEW
      // session with the old account.
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

  /** True while `sessionId` is still the session this runtime is running, and
   *  this runtime is still running at all. */
  function sessionAlive(sessionId: number): boolean {
    return !disposed && session.fenced(sessionId);
  }

  /** A live session on a running runtime — the gate on every timer, dial
   *  and pass. */
  function live(): boolean {
    return !disposed && session.current().kind === "live";
  }

  /** {@link sessionAlive} for a pass. Checked after EVERY await, immediately
   *  before any write. */
  function fenced(context: PassContext): boolean {
    return sessionAlive(context.sessionId);
  }

  const stored = readDeviceCredential(args.dataDir);
  if (stored !== null) {
    openSession(stored);
  }

  // -- timers and the socket ------------------------------------------------

  const link = createSocketLink({
    baseUrl: args.cloudUrl,
    openSocket: transport.openSocket ?? null,
    // This process owns the vault and drives the agent, so it is the machine
    // a `desktop`-lane dispatch is addressed to. Answering one is a later
    // round's work; saying what this device IS is not.
    platform: "desktop",
    canConnect: live,
    credential: () => {
      const current = session.current();
      return current.kind === "live" ? current.credential.credential : null;
    },
    onPing: (ping) => {
      // Invalidation-only frames, so each means "ask the server what
      // changed" — including `dispatch`, whose thread still wants pulling so
      // it shows up here rather than existing only in the cloud. A `sync`
      // ping carries the log's high-water precisely so a client can tell one
      // it already covers from news. `vault` is the one frame that is not
      // about THIS log: another device pushed vault bytes, and the pass
      // that answers it is the git engine's, not this runtime's.
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
      // A hint that this device was revoked — the pass is what turns it into
      // a fact, because only an HTTP refusal is authoritative.
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

  /** The one spelling of "stop talking to the cloud": the socket, its
   *  reconnect and both timers together — every session transition runs it. */
  function haltTransport(): void {
    link.close();
    cadence.clear();
  }

  // -- failure handling -----------------------------------------------------

  /** The session machine's verdict, passed through: "ended" means the failure
   *  ended this device's session and the caller stops. The unauthorized
   *  transition is the machine's too; `onEnded` above halts the transport. */
  function recordFailure(failure: CloudFailure): "continue" | "ended" {
    lastError = describeCloudFailure(failure);
    const outcome = session.recordFailure(failure);
    if (outcome === "continue") debug(lastError);
    return outcome;
  }

  // -- the pass -------------------------------------------------------------

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
    // Captured ONCE. Every step below re-checks it rather than re-reading the
    // session, so a pass can never finish its work against a session that is
    // no longer the one it started under.
    const context: PassContext = {
      sessionId: current.id,
      client: current.client,
      deviceId: current.credential.deviceId,
    };
    if (current.credential.userId === undefined) {
      // A no-op once learned, so this is the poll interval's own recovery
      // cadence for the one fetch nothing else retries.
      await learnAccountIdentity();
      if (!fenced(context)) {
        return;
      }
    }
    await runSyncPass(passDeps, context);
  }

  // -- the surface ----------------------------------------------------------

  function status(): CloudStatusResponse {
    const current = session.current();
    switch (current.kind) {
      case "off":
        return { state: "off", cloudUrl: args.cloudUrl };
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
          state: "paired",
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

  // -- pairing --------------------------------------------------------------

  async function adoptPairedCredential(credential: DeviceCredential): Promise<void> {
    // A fresh pairing starts from a clean slate whether or not one was held
    // before: the outbox and both positions describe an account this device
    // may no longer be talking to. `openSession` below ends the old session,
    // which is what stops a pass still running under it from acking into
    // the queue this reset just emptied.
    haltTransport();
    resetSyncState(args.db);
    writeDeviceCredential(args.dataDir, credential);
    openSession(credential);
    lastError = null;
    link.resetBackoff();
    cadence.armPoll();
    link.connect();
    await syncNow();
    // The pairing just derived a hosted vault remote; sync it now rather
    // than on the next interval tick.
    args.onVaultPing?.();
  }

  const pairFlowDeps: PairFlowDeps = {
    cloudUrl: args.cloudUrl,
    openExternalUrl,
    isDisposed: () => disposed,
    adoptCredential: adoptPairedCredential,
    status,
  };
  if (transport.fetch !== undefined) pairFlowDeps.fetch = transport.fetch;
  const pairFlow = createPairFlow(pairFlowDeps);

  return {
    status,

    enqueue(tx, events) {
      if (session.current().kind !== "live" || events.length === 0) {
        // An unpaired install queues nothing. The trade, stated: pairing later
        // syncs from that moment rather than backfilling — the log is the
        // account's history, not this device's, and a device that queued for
        // months before anyone paired would push a backlog no other device has
        // a base for.
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

    beginPair: (request) => pairFlow.beginPair(request),
    completePair: (request) => pairFlow.completePair(request),

    unpair() {
      session.close();
      haltTransport();
      // An armed approval outlives the credential it was meant to replace
      // otherwise, and "stop syncing this device" followed by a silent re-pair
      // a minute later is not what the button said.
      pairFlow.cancel();
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
      // Drop any armed approval: a callback arriving mid-teardown must find
      // nothing to complete (completePair also guards on `disposed`, but the
      // slot itself should not outlive the runtime that owns it).
      pairFlow.cancel();
      // Cancels the requests in flight. Without it the teardown step's budget
      // is a hope: awaiting the pass would wait out every remaining round
      // trip, and it would keep writing — the vault included — after the
      // process was told to stop.
      session.abort();
      // A pass mid-flight owns a transaction and a request; letting it finish
      // is what keeps the outbox's ack and its push in agreement.
      await flight.inflight()?.catch(() => undefined);
    },
  };
}
