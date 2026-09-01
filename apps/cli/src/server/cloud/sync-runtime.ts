// Cloud thread sync: the loop that carries this device's thread events to the
// account's merged log and applies everyone else's back.
//
// SYNC IS OFF UNTIL SOMEONE PAIRS, and the credential file IS the switch.
// There is no second "enabled" flag, because two values that must agree are
// two values that can disagree — a flag off beside a live credential leaves a
// working credential nothing uses, and a flag on beside none is a promise no
// loop can keep. With no credential this object opens no socket, arms no
// timer and makes no request; `status()` answers `off` and every verb but the
// two halves of pairing is a no-op.
//
// PAIRING IS TWO HALVES because a browser is in the middle of it (issue #573):
// `beginPair` arms a single-use `state` and answers the approve page's URL,
// and `completePair` is what the loopback callback runs when that browser
// comes back. The state is this object's, not the route's, because it is the
// thing that says a callback belongs to a request THIS app made.
//
// ONE DIRECTION AT A TIME, in one pass: drain the outbox, page the log
// forward, then take the capture inbox. A pass is single-flight and coalescing
// — a ping that lands mid-pass marks the pass dirty rather than starting a
// second one, because two concurrent drains would push the same batch twice
// and two concurrent pulls would apply the same page twice.
//
// THE CURSOR MOVES INSIDE THE APPLY'S OWN TRANSACTION. That is what makes a
// pulled event land exactly once: appending it and recording that it was
// applied are one write, so a crash between them is impossible and a replay of
// the page cannot duplicate a row. Advancing afterwards would have been a
// second write, and the window between them is precisely where a duplicated
// conversation comes from.
//
// THE SOCKET IS LATENCY, NEVER CORRECTNESS. It carries invalidation pings the
// contract keeps payload-free, so a missed one costs staleness until the next
// timer tick. The reconnect exists for the same reason and gives up on nothing
// — except a credential the cloud has refused, which is the one failure a
// retry cannot fix.

import { hostname } from "node:os";
import { CLAIM_DEFAULT_LIMIT } from "@repo/api/cloud/captures/captures-schema";
import { SYNC_OUTBOX_CODES } from "@repo/api/cloud/errors";
import {
  createPairingFlow,
  type PairCompletion as PairingMachineCompletion,
} from "@repo/api/cloud/pairing/pairing-flow";
import type { LogPlanStep } from "@repo/api/cloud/sync/plan-page";
import {
  createSingleFlight,
  createSyncSession,
  pullPages,
} from "@repo/api/cloud/sync/sync-session";
import type { DbConnection, DbTransaction } from "@repo/db/connection";
import type { SyncedEventInput } from "@repo/db/events";
import {
  countSyncOutbox,
  deleteSyncOutboxThrough,
  pruneAppliedCaptures,
  readSyncState,
  recordAppliedCaptures,
  resetSyncState,
  touchSyncedAt,
  unappliedCaptureIds,
  writeSyncCursor,
} from "@repo/db/sync-outbox";
import type { ThreadEvent } from "@repo/domain/provider-event";
import type {
  CloudPairBeginResponse,
  CloudStatusResponse,
} from "@repo/api/local/cloud/cloud-schema";
import { systemOpenExternalUrl, type OpenExternalUrl } from "./browser-opener";
import { appendToInbox, APPLIED_CAPTURE_RETENTION_MS, type CaptureVault } from "./captures";
import {
  createCloudClient,
  describeCloudFailure,
  type CloudClient,
  type CloudEndpoint,
  type CloudFailure,
  type CloudFetch,
  type CloudSocket,
  type CloudSocketOpener,
  type CreateCloudClientArgs,
} from "@repo/api/cloud/client";
import {
  clearDeviceCredential,
  readDeviceCredential,
  writeDeviceCredential,
  type DeviceCredential,
} from "./credential-store";
import { ackPushBatch, enqueueThreadEvents, takePushBatch } from "./outbox";
import { messageOf } from "../error-message";

/** The fallback cadence. The socket is what makes sync feel immediate; this is
 *  what makes it CORRECT when the socket is down, so it is deliberately slow. */
const POLL_INTERVAL_MS = 60_000;

/**
 * How long a local append waits before its pass runs. A streaming turn appends
 * thousands of events, and a pass per event would be a request per token; a
 * short window turns the burst into one batch. Scheduled from inside the
 * append's own transaction, which is safe precisely because a `setTimeout`
 * callback cannot run until better-sqlite3's synchronous transaction has
 * returned — so the pass always sees committed rows.
 */
const PUSH_DEBOUNCE_MS = 1_500;

/** Bound on one pass's drain, so a huge backlog cannot starve the pull half
 *  (or hold a shutdown open). What is left rides the next pass; the pull
 *  half's twin bound is the page loop's own. */
const MAX_PUSH_BATCHES_PER_PASS = 25;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

/** RFC 6455 policy violation — what the cloud closes a revoked device's socket
 *  with. Treated as a hint, never as the verdict: the next HTTP call is what
 *  actually establishes that a credential is dead. */
const SEVERED_CLOSE_CODE = 1008;

/**
 * The one-transaction ingest, as this runtime needs it. Implemented by
 * `ThreadService`, which is the ONLY writer of thread events — a second append
 * path here would be a second answer to thread lifecycle.
 */
export interface SyncedEventSink {
  applySyncedEvents(args: {
    threadId: string;
    /** Each event WITH the log row's own identity, so the append can be
     *  idempotent on it — see `@repo/db/events`. */
    rows: readonly SyncedEventInput[];
    /** The log position these rows settle, written in the SAME transaction
     *  that appends them. */
    cursor: number;
  }): void;
}

/**
 * What the loopback callback did — the machine's own refusals, each of which
 * gets its own sentence on the page a browser lands on, with the paired arm
 * carrying this runtime's status instead of the bare credential.
 */
export type PairCompletion =
  | { kind: "paired"; status: CloudStatusResponse }
  | Exclude<PairingMachineCompletion, { kind: "paired" }>;

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

export interface BeginPairArgs {
  callbackUrl: string;
  deviceName?: string;
  openBrowser: boolean;
}

export interface CloudRuntime {
  status(): CloudStatusResponse;
  /** The outbox hook the thread service calls inside its append transaction. */
  enqueue(tx: DbTransaction, events: readonly ThreadEvent[]): void;
  /** Late-bound: the sink is built after this runtime, because the thread
   *  service needs `enqueue` at construction. */
  attach(sink: SyncedEventSink): void;
  start(): void;
  /**
   * Arm an approval and hand back the page that grants it.
   *
   * `callbackUrl` is where the browser will be sent afterwards, and it has
   * ALREADY been through `pairRedirectUrlSchema` — `pair-callback.ts` is the
   * one gate, so nothing here re-decides which targets are admissible.
   */
  beginPair(args: BeginPairArgs): Promise<CloudPairBeginResponse>;
  /** Redeem `code`, but only for the approval this app is actually waiting on. */
  completePair(args: { code: string; state: string }): Promise<PairCompletion>;
  unpair(): CloudStatusResponse;
  syncNow(): Promise<CloudStatusResponse>;
  dispose(): Promise<void>;
}

/** What one pass runs under: the session it belongs to, and the credential's
 *  own identity. Captured once at the top so no step can read a newer one. */
interface PassContext {
  sessionId: number;
  client: CloudClient;
  deviceId: string;
}

export function createCloudRuntime(args: CloudRuntimeArgs): CloudRuntime {
  const transport = args.transport ?? {};
  const debug = args.onDebug ?? ((message: string) => console.error(`cloud: ${message}`));
  const openExternalUrl = args.openExternalUrl ?? systemOpenExternalUrl;
  const openSocket = transport.openSocket ?? null;
  const pollIntervalMs =
    transport.pollIntervalMs === undefined ? POLL_INTERVAL_MS : transport.pollIntervalMs;

  let sink: SyncedEventSink | null = null;
  let socket: CloudSocket | null = null;
  let connected = false;
  let lastError: string | null = null;
  let disposed = false;

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  /** Which dial the live callbacks belong to — see `connect`. */
  let socketGeneration = 0;
  const flight = createSingleFlight();
  /** The pairing handshake — the slot, the TTL, the constant-time state
   *  compare and the PKCE-bound redeem are the contract's machine; this
   *  runtime wraps it with the disposed guard, the browser opener and the
   *  session it opens on success. */
  const pairing = createPairingFlow(
    transport.fetch === undefined
      ? { cloudUrl: args.cloudUrl }
      : { cloudUrl: args.cloudUrl, fetch: transport.fetch },
  );
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
      closeSocket();
      clearTimers();
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

  function clearTimers(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function closeSocket(): void {
    socketGeneration += 1;
    socket?.close();
    socket = null;
    connected = false;
  }

  function scheduleReconnect(): void {
    if (
      disposed ||
      session.current().kind !== "live" ||
      openSocket === null ||
      reconnectTimer !== null
    ) {
      return;
    }
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempt);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
    reconnectTimer.unref?.();
  }

  function connect(): void {
    const current = session.current();
    if (disposed || current.kind !== "live" || socket !== null || openSocket === null) {
      return;
    }
    const credential = current.credential.credential;
    // A generation, because an opener may report a terminal failure BEFORE it
    // returns: the assignment below would then overwrite the null its own
    // `onClose` just wrote, and this runtime would hold a dead handle it never
    // replaces. Bumping the counter from inside the callback makes the
    // assignment refuse itself.
    const generation = socketGeneration + 1;
    socketGeneration = generation;
    const opened = openSocket({
      baseUrl: args.cloudUrl,
      credential,
      // This process owns the vault and drives the agent, so it is the machine
      // a `desktop`-lane dispatch is addressed to. Answering one is a later
      // round's work; saying what this device IS is not.
      platform: "desktop",
      onOpen: () => {
        if (generation !== socketGeneration) {
          return;
        }
        connected = true;
        reconnectAttempt = 0;
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
      onClose: (code) => {
        if (generation !== socketGeneration) {
          return;
        }
        socketGeneration += 1;
        socket = null;
        connected = false;
        if (code === SEVERED_CLOSE_CODE) {
          // A hint that this device was revoked — the pass below is what turns
          // it into a fact, because only an HTTP refusal is authoritative.
          void syncNow();
        }
        scheduleReconnect();
      },
    });
    if (generation === socketGeneration) {
      socket = opened;
    }
  }

  function armTimers(): void {
    if (
      disposed ||
      session.current().kind !== "live" ||
      pollIntervalMs === null ||
      pollTimer !== null
    ) {
      return;
    }
    pollTimer = setInterval(() => {
      void syncNow();
    }, pollIntervalMs);
    // Never the reason this process stays alive.
    pollTimer.unref?.();
  }

  function scheduleDrain(): void {
    if (
      disposed ||
      session.current().kind !== "live" ||
      pollIntervalMs === null ||
      debounceTimer !== null
    ) {
      return;
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void syncNow();
    }, PUSH_DEBOUNCE_MS);
    debounceTimer.unref?.();
  }

  // -- failure handling -----------------------------------------------------

  /** True when the failure ends this device's session; the caller stops. The
   *  verdict and the unauthorized transition are the session machine's;
   *  `onEnded` above closes the socket and the timers. */
  function recordFailure(failure: CloudFailure): boolean {
    lastError = describeCloudFailure(failure);
    const outcome = session.recordFailure(failure);
    if (outcome === "continue") debug(lastError);
    return outcome === "ended";
  }

  // -- the pass -------------------------------------------------------------

  /**
   * Drain the outbox. Returns false when the session ended.
   *
   * An outbox refusal is not retried: the log already holds a body at that
   * position (`sync-conflict`) or holds one past it (`sync-out-of-order`), so
   * the queued row can never land where it is numbered, and keeping it wedges
   * every event behind it forever. The rows through the named position are
   * dropped and the error is recorded loudly. What is lost is the CLOUD's copy
   * of those events — the local log still holds every one of them — and the
   * only way to reach this state is a database that lost its counter while the
   * account's log kept the positions it handed out.
   */
  async function drain(context: PassContext): Promise<boolean> {
    for (let round = 0; round < MAX_PUSH_BATCHES_PER_PASS; round += 1) {
      if (!fenced(context)) {
        return false;
      }
      const batch = takePushBatch(args.db);
      if (batch === null) {
        return true;
      }
      for (const row of batch.rejected) {
        debug(`dropping outbox position ${row.deviceSeq}: ${row.reason}`);
      }
      if (batch.request.events.length === 0) {
        ackPushBatch(args.db, batch);
        continue;
      }
      const result = await context.client.push(batch.request);
      // The ack DELETES rows. A pair or unpair that landed while this request
      // was in flight has already emptied and re-numbered that queue, so an
      // ack from the old session would delete the new one's work.
      if (!fenced(context)) {
        return false;
      }
      if (!result.ok) {
        if (result.failure.kind === "refused" && SYNC_OUTBOX_CODES.has(result.failure.code)) {
          const through = result.failure.deviceSeq ?? batch.throughDeviceSeq;
          const dropped = deleteSyncOutboxThrough(args.db, through);
          debug(
            `${result.failure.code} at position ${through}: dropped ${dropped} queued event(s) the log will not take`,
          );
          lastError = describeCloudFailure(result.failure);
          continue;
        }
        return !recordFailure(result.failure);
      }
      ackPushBatch(args.db, batch);
      lastError = null;
    }
    return true;
  }

  function applyStep(step: Extract<LogPlanStep, { kind: "apply" }>): void {
    const target = sink;
    if (target === null) {
      throw new Error("cloud sync has no ingest sink attached");
    }
    const groupCursor = step.rows.at(-1)?.seq;
    if (groupCursor === undefined) {
      return;
    }
    try {
      target.applySyncedEvents({ threadId: step.threadId, rows: step.rows, cursor: groupCursor });
      return;
    } catch (error) {
      debug(`applying ${step.rows.length} synced event(s) failed: ${messageOf(error)}`);
    }
    // One event the local log refuses — a turn-content event whose
    // `turn/started` this device never received, which is what pairing
    // mid-turn produces — must not take the rest of the group with it. Retried
    // one at a time so the group's good events still land.
    //
    // EACH RETRY COMMITS ITS OWN ROW'S POSITION, never the group's. The append
    // and the cursor share one transaction, so handing every retry the group's
    // last seq would durably record rows 2..n as seen the moment row 1
    // committed — and a crash there loses them for good.
    for (const row of step.rows) {
      try {
        target.applySyncedEvents({ threadId: step.threadId, rows: [row], cursor: row.seq });
      } catch (individual) {
        debug(`skipping a synced ${row.event.type}: ${messageOf(individual)}`);
        // Nothing committed this row's position, and every row before it is
        // settled — so move past it here, or the next pass replays the same
        // refusal forever.
        writeSyncCursor(args.db, row.seq);
      }
    }
  }

  /** Page the log forward and apply everything this device did not write —
   *  the contract's own loop, over this platform's store. Returns false when
   *  the session ended. */
  function pullAndApply(context: PassContext): Promise<boolean> {
    return pullPages({
      client: context.client,
      deviceId: context.deviceId,
      fenced: () => fenced(context),
      readCursor: () => readSyncState(args.db).cursor,
      applyPlan: (steps) => {
        for (const step of steps) {
          if (step.kind === "apply") {
            applyStep(step);
          } else {
            writeSyncCursor(args.db, step.cursor);
          }
        }
      },
      recordFailure: (failure) => (recordFailure(failure) ? "ended" : "continue"),
      onPage: () => {
        lastError = null;
      },
      onSkipped: debug,
    });
  }

  /**
   * Take the capture inbox, write what this device has not written before, and
   * ack.
   *
   * THE ORDER IS THE GUARANTEE, and it is worth being exact about which
   * guarantee, because the ledger closes one window and not the other.
   *
   * The vault write commits, THEN the id is recorded, THEN the claim is acked.
   * The window the ledger DOES close is the contract's own: a claim that lapses
   * after this device applied hands the same capture to whoever claims next,
   * and the ledger makes the second apply a no-op.
   *
   * The window it does NOT close is a crash between the vault write and the
   * ledger insert — two stores, no shared transaction, so there is no order
   * that makes both true at once. A process that dies in that gap writes the
   * bullet again when the capture is redelivered. That direction is CHOSEN:
   * recording first would instead lose the capture outright, and
   * `@repo/api/cloud/captures/captures-schema` states the trade plainly — a lost capture
   * is unrecoverable, a duplicated one is a line a reader deletes.
   */
  async function applyCaptures(context: PassContext): Promise<boolean> {
    if (!fenced(context)) {
      return false;
    }
    const claimed = await context.client.claimCaptures(CLAIM_DEFAULT_LIMIT);
    // A claim belongs to the account that granted it, and what follows WRITES
    // THE VAULT — the one step here whose side effect outlives the session.
    if (!fenced(context)) {
      return false;
    }
    if (!claimed.ok) {
      return !recordFailure(claimed.failure);
    }
    const captures = claimed.value.captures;
    if (captures.length === 0) {
      return true;
    }
    const fresh = unappliedCaptureIds(
      args.db,
      captures.map((capture) => capture.id),
    );
    const toWrite = captures.filter((capture) => fresh.has(capture.id));
    if (toWrite.length > 0) {
      const written = await appendToInbox(args.vault, toWrite);
      if (!fenced(context)) {
        return false;
      }
      if (!written.applied) {
        // Nothing recorded and nothing acked: the claim lapses and the inbox
        // hands these to whoever claims next.
        debug(written.reason);
        return true;
      }
      recordAppliedCaptures(
        args.db,
        toWrite.map((capture) => capture.id),
        Date.now(),
      );
    }
    const acked = await context.client.ackCaptures({
      claimToken: claimed.value.claimToken,
      ids: captures.map((capture) => capture.id),
    });
    if (!fenced(context)) {
      return false;
    }
    if (!acked.ok) {
      return !recordFailure(acked.failure);
    }
    for (const outcome of acked.value.results) {
      if (outcome.outcome === "reclaimed") {
        debug(`capture ${outcome.id} was reclaimed before this device acked it`);
      }
    }
    pruneAppliedCaptures(args.db, Date.now() - APPLIED_CAPTURE_RETENTION_MS);
    return true;
  }

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
    if (!(await drain(context))) {
      return;
    }
    if (!(await pullAndApply(context))) {
      return;
    }
    if (!(await applyCaptures(context))) {
      return;
    }
    if (!fenced(context)) {
      return;
    }
    // "Checked" is a different fact from "caught up": a device with nothing to
    // pull is up to date, and a status that only moved on new rows would read
    // as stale forever on a quiet account.
    touchSyncedAt(args.db, Date.now());
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
          connected,
          pending: countSyncOutbox(args.db),
          cursor: state.cursor,
          lastSyncedAt: state.lastSyncedAt,
          lastError,
        };
      }
    }
  }

  async function syncNow(): Promise<CloudStatusResponse> {
    if (session.current().kind !== "live" || disposed) {
      return status();
    }
    await flight.run({
      pass: runPass,
      repeat: () => !disposed && session.current().kind === "live",
      onError: (message) => {
        lastError = message;
        debug(`sync pass failed: ${message}`);
      },
    });
    return status();
  }

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
      scheduleDrain();
    },

    attach(next) {
      sink = next;
    },

    start() {
      if (session.current().kind !== "live") {
        return;
      }
      armTimers();
      connect();
      void syncNow();
    },

    async beginPair(request) {
      // `hostname()` raw: the machine bounds and defaults the name, so an
      // empty or oversized one never reaches the cloud as a shape error about
      // a name the user never typed.
      const { url, deviceName, expiresInMs } = await pairing.begin({
        redirect: request.callbackUrl,
        deviceName: request.deviceName ?? hostname(),
      });
      if (disposed) {
        // Teardown has started: arm nothing and open nothing. The URL is still
        // answered so an in-flight caller gets a coherent reply, but no slot
        // outlives the process — and `completePair` refuses a disposed runtime
        // regardless.
        pairing.cancel();
        return { url, opened: false, deviceName, expiresInMs };
      }
      // Awaited, so `opened` is observed rather than assumed — and false is an
      // ordinary answer here, since the caller may have asked for no window at
      // all.
      const opened = request.openBrowser ? await openExternalUrl(url) : false;
      return { url, opened, deviceName, expiresInMs };
    },

    async completePair(request) {
      if (disposed) {
        // A callback in flight during ordered shutdown must not redeem over the
        // network and write a credential after teardown. Same answer as an
        // unarmed slot: nothing was completable.
        return { kind: "no-pending" };
      }
      const completion = await pairing.complete(request);
      if (completion.kind !== "paired") {
        return completion;
      }
      if (disposed) {
        // Teardown ran during the redeem round trip: do not write a credential
        // or open a session after the process was told to stop.
        return { kind: "no-pending" };
      }
      // A fresh pairing starts from a clean slate whether or not one was held
      // before: the outbox and both positions describe an account this device
      // may no longer be talking to. `openSession` below ends the old session,
      // which is what stops a pass still running under it from acking into
      // the queue this reset just emptied.
      closeSocket();
      clearTimers();
      resetSyncState(args.db);
      const credential: DeviceCredential = completion.credential;
      writeDeviceCredential(args.dataDir, credential);
      openSession(credential);
      lastError = null;
      reconnectAttempt = 0;
      armTimers();
      connect();
      await syncNow();
      // The pairing just derived a hosted vault remote; sync it now rather
      // than on the next interval tick.
      args.onVaultPing?.();
      return { kind: "paired", status: status() };
    },

    unpair() {
      session.close();
      closeSocket();
      clearTimers();
      // An armed approval outlives the credential it was meant to replace
      // otherwise, and "stop syncing this device" followed by a silent re-pair
      // a minute later is not what the button said.
      pairing.cancel();
      clearDeviceCredential(args.dataDir);
      resetSyncState(args.db);
      lastError = null;
      reconnectAttempt = 0;
      return status();
    },

    syncNow,

    async dispose() {
      disposed = true;
      clearTimers();
      closeSocket();
      // Drop any armed approval: a callback arriving mid-teardown must find
      // nothing to complete (completePair also guards on `disposed`, but the
      // slot itself should not outlive the runtime that owns it).
      pairing.cancel();
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
