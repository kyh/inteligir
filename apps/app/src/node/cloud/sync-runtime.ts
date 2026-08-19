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

import { randomBytes, timingSafeEqual } from "node:crypto";
import { hostname } from "node:os";
import { CLAIM_DEFAULT_LIMIT } from "@repo/cloud-contract/captures";
import type { CloudErrorCode } from "@repo/cloud-contract/errors";
import {
  buildPairApproveUrl,
  DEVICE_NAME_MAX_LENGTH,
  generatePkceVerifier,
  PAIR_STATE_BYTES,
  pkceChallengeS256,
} from "@repo/cloud-contract/pairing";
import { PULL_DEFAULT_LIMIT, type SyncEventRow } from "@repo/cloud-contract/sync";
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
import { threadEventSchema, type ThreadEvent } from "@repo/domain/provider-event";
import type { CloudPairBeginResponse, CloudStatusResponse } from "@repo/server-contract/cloud";
import { systemOpenExternalUrl, type OpenExternalUrl } from "./browser-opener";
import { appendToInbox, APPLIED_CAPTURE_RETENTION_MS, type CaptureVault } from "./captures";
import {
  createCloudClient,
  describeCloudFailure,
  redeemDevice,
  type CloudClient,
  type CloudFailure,
  type CloudFetch,
  type CloudSocket,
  type CloudSocketOpener,
} from "./cloud-client";
import {
  clearDeviceCredential,
  readDeviceCredential,
  writeDeviceCredential,
  type DeviceCredential,
} from "./credential-store";
import { ackPushBatch, enqueueThreadEvents, takePushBatch } from "./outbox";
import { messageOf } from "../knowledge/message-of";

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
 *  (or hold a shutdown open). What is left rides the next pass. */
const MAX_PUSH_BATCHES_PER_PASS = 25;
/** The same bound for the pull half. */
const MAX_PULL_PAGES_PER_PASS = 25;

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
 * How long an approval this app started stays completable.
 *
 * Its own constant rather than the code's TTL: the two bound different things.
 * The code's clock starts when the user presses Approve; this one starts a
 * whole sign-in round trip earlier, and the reason it is bounded at all is that
 * a `state` left armed forever is a callback URL that keeps working long after
 * the user forgot they asked for one.
 */
const PENDING_PAIR_TTL_MS = 10 * 60_000;

/** The approval this app is waiting on. ONE slot: a second `begin` is the user
 *  pressing the button again, and two live states would mean an approval could
 *  complete a request nobody remembers making. */
interface PendingPair {
  state: string;
  /** The PKCE secret. Kept HERE, never on the wire the browser rides: the
   *  challenge it hashes to is all that travels, and redeem needs this back to
   *  prove the code reached the app that began the pairing. */
  verifier: string;
  deviceName: string;
  expiresAt: number;
}

/**
 * What the loopback callback did. Each refusal is its own member because each
 * one gets its own sentence on the page a browser lands on — "nothing was
 * waiting for this" and "that took too long" are different things to have done
 * wrong, and a single `false` would render as the same shrug for both.
 */
export type PairCompletion =
  | { kind: "paired"; status: CloudStatusResponse }
  | { kind: "no-pending" }
  | { kind: "state-mismatch" }
  | { kind: "expired" }
  | { kind: "refused"; failure: CloudFailure };

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
  /**
   * Arm an approval and hand back the page that grants it.
   *
   * `callbackUrl` is where the browser will be sent afterwards, and it has
   * ALREADY been through `pairRedirectUrlSchema` — `pair-callback.ts` is the
   * one gate, so nothing here re-decides which targets are admissible.
   */
  beginPair(args: {
    callbackUrl: string;
    deviceName?: string;
    openBrowser: boolean;
  }): Promise<CloudPairBeginResponse>;
  /** Redeem `code`, but only for the approval this app is actually waiting on. */
  completePair(args: { code: string; state: string }): Promise<PairCompletion>;
  unpair(): CloudStatusResponse;
  syncNow(): Promise<CloudStatusResponse>;
  dispose(): Promise<void>;
}

/** A refusal that means the credential is finished. Both are terminal for this
 *  device: `unauthorized` is a revoked or unknown credential, `account-deleted`
 *  is a tombstoned account that every route refuses against. */
const TERMINAL_CODES: ReadonlySet<CloudErrorCode> = new Set(["unauthorized", "account-deleted"]);

/** A refusal that means THIS DEVICE'S OWN OUTBOX disagrees with the log, and
 *  names the position that did. */
const OUTBOX_CODES: ReadonlySet<CloudErrorCode> = new Set(["sync-conflict", "sync-out-of-order"]);

/**
 * `id` is the fence. Every session gets a fresh one, and a pass captures the id
 * it started under and re-checks it after EVERY await — because "is a session
 * live?" is the wrong question when the answer can be yes about a DIFFERENT
 * session. Two ways that bites, both of them writes into the wrong account:
 * an in-flight push whose ack deletes the outbox rows a re-pairing has since
 * queued, and an in-flight pull whose page applies into the new pairing and
 * drags the cursor past rows it never saw.
 */
type Session =
  | { kind: "off"; id: number }
  | { kind: "live"; id: number; credential: DeviceCredential; client: CloudClient }
  | { kind: "unauthorized"; id: number; credential: DeviceCredential; detail: string };

/** What one pass runs under: the session it belongs to, and the credential's
 *  own identity. Captured once at the top so no step can read a newer one. */
interface PassContext {
  sessionId: number;
  client: CloudClient;
  deviceId: string;
}

/**
 * What this machine calls itself on the account, when nobody says otherwise.
 *
 * Bounded and defaulted rather than trusted: `hostname()` can answer an empty
 * string on a misconfigured box and can exceed the cloud's own ceiling, and
 * either one would be refused by a schema several steps later — as a shape
 * error about a name the user never typed.
 */
function defaultDeviceName(): string {
  const name = hostname().trim().slice(0, DEVICE_NAME_MAX_LENGTH);
  return name.length === 0 ? "this device" : name;
}

/** Constant-time, and length-checked first because `timingSafeEqual` throws on
 *  a length mismatch. The state is a secret a caller is guessing at, so it is
 *  compared the way a secret is. */
function sameState(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createCloudRuntime(args: CloudRuntimeArgs): CloudRuntime {
  const transport = args.transport ?? {};
  const debug = args.onDebug ?? ((message: string) => console.error(`cloud: ${message}`));
  const openExternalUrl = args.openExternalUrl ?? systemOpenExternalUrl;
  const openSocket = transport.openSocket ?? null;
  const pollIntervalMs =
    transport.pollIntervalMs === undefined ? POLL_INTERVAL_MS : transport.pollIntervalMs;

  let sink: SyncedEventSink | null = null;
  let sessionCounter = 0;
  let session: Session = { kind: "off", id: 0 };
  /** Aborted whenever the session ends — a pair, an unpair, a refused
   *  credential, or dispose — so a request belonging to it stops being paid
   *  for the moment it stops mattering. */
  let sessionAbort = new AbortController();
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
  let inflight: Promise<void> | null = null;
  let dirty = false;
  let pendingPair: PendingPair | null = null;

  /** End the current session and hand back a fresh, un-aborted controller.
   *  Called by every transition, so no path can forget to cancel. */
  function closeSession(): void {
    sessionAbort.abort();
    sessionAbort = new AbortController();
  }

  function openSession(credential: DeviceCredential): void {
    closeSession();
    sessionCounter += 1;
    session = {
      kind: "live",
      id: sessionCounter,
      credential,
      client: createCloudClient({
        baseUrl: args.cloudUrl,
        credential: credential.credential,
        signal: sessionAbort.signal,
        ...(transport.fetch === undefined ? {} : { fetch: transport.fetch }),
      }),
    };
  }

  /** True while `context`'s session is still the one this runtime is running,
   *  and this runtime is still running at all. Checked after EVERY await,
   *  immediately before any write. */
  function fenced(context: PassContext): boolean {
    return !disposed && session.kind === "live" && session.id === context.sessionId;
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
    if (disposed || session.kind !== "live" || openSocket === null || reconnectTimer !== null) {
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
    if (disposed || session.kind !== "live" || socket !== null || openSocket === null) {
      return;
    }
    const credential = session.credential.credential;
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
        // Invalidation-only frames, so all three mean "ask the server what
        // changed" — including `dispatch`, whose thread still wants pulling so
        // it shows up here rather than existing only in the cloud. A `sync`
        // ping carries the log's high-water precisely so a client can tell one
        // it already covers from news.
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
    if (disposed || session.kind !== "live" || pollIntervalMs === null || pollTimer !== null) {
      return;
    }
    pollTimer = setInterval(() => {
      void syncNow();
    }, pollIntervalMs);
    // Never the reason this process stays alive.
    pollTimer.unref?.();
  }

  function scheduleDrain(): void {
    if (disposed || session.kind !== "live" || pollIntervalMs === null || debounceTimer !== null) {
      return;
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void syncNow();
    }, PUSH_DEBOUNCE_MS);
    debounceTimer.unref?.();
  }

  // -- failure handling -----------------------------------------------------

  /** True when the failure ends this device's session; the caller stops. */
  function recordFailure(failure: CloudFailure): boolean {
    lastError = describeCloudFailure(failure);
    if (failure.kind !== "refused" || !TERMINAL_CODES.has(failure.code)) {
      debug(lastError);
      return false;
    }
    if (session.kind === "live") {
      sessionCounter += 1;
      session = {
        kind: "unauthorized",
        id: sessionCounter,
        credential: session.credential,
        detail: failure.message,
      };
    }
    closeSession();
    closeSocket();
    clearTimers();
    debug(`credential refused (${failure.code}): ${failure.message}`);
    return true;
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
        if (result.failure.kind === "refused" && OUTBOX_CODES.has(result.failure.code)) {
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

  /**
   * What a page of the log becomes before any of it is written.
   *
   * `apply` merges CONSECUTIVE rows for one thread, so a streaming turn's
   * deltas land as one transaction and one invalidation rather than hundreds.
   * `skip` is the rest — this device's own rows coming back through the merged
   * log, and rows in a grammar this build does not know — and it exists as a
   * step of its own because the cursor still has to move past them.
   *
   * The plan is built first and executed second on purpose: deciding and
   * writing in one loop is where the "did this row move the cursor?" bookkeeping
   * got tangled, and a mis-set cursor is a duplicated conversation.
   */
  interface PlannedRow extends SyncedEventInput {
    /** The ACCOUNT log's global position — the cursor value this row alone
     *  settles. Kept per row, not per group, because the per-row retry below
     *  commits each one separately. */
    seq: number;
  }

  type PlanStep =
    | { kind: "apply"; threadId: string; rows: PlannedRow[] }
    | { kind: "skip"; cursor: number };

  function planPage(rows: readonly SyncEventRow[], deviceId: string): PlanStep[] {
    const steps: PlanStep[] = [];
    for (const row of rows) {
      const last = steps.at(-1);
      // This device already holds what it wrote; re-appending would double
      // every event it ever pushed.
      const mine = row.deviceId === deviceId;
      const event = mine ? null : threadEventSchema.safeParse(row.event);
      if (event !== null && !event.success) {
        debug(`skipping log row ${row.seq}: not a thread event this build understands`);
      }
      if (event === null || !event.success) {
        if (last?.kind === "skip") {
          last.cursor = row.seq;
        } else {
          steps.push({ kind: "skip", cursor: row.seq });
        }
        continue;
      }
      const planned: PlannedRow = {
        event: event.data,
        origin: { deviceId: row.deviceId, deviceSeq: row.deviceSeq },
        seq: row.seq,
      };
      if (last?.kind === "apply" && last.threadId === row.threadId) {
        last.rows.push(planned);
        continue;
      }
      steps.push({ kind: "apply", threadId: row.threadId, rows: [planned] });
    }
    return steps;
  }

  function applyStep(step: Extract<PlanStep, { kind: "apply" }>): void {
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

  /** Page the log forward and apply everything this device did not write.
   *  Returns false when the session ended. */
  async function pullAndApply(context: PassContext): Promise<boolean> {
    for (let page = 0; page < MAX_PULL_PAGES_PER_PASS; page += 1) {
      if (!fenced(context)) {
        return false;
      }
      const cursor = readSyncState(args.db).cursor;
      const result = await context.client.pull({ afterSeq: cursor, limit: PULL_DEFAULT_LIMIT });
      // This page belongs to the account this pass started under. Applying it
      // after a re-pair would write another account's events into this one and
      // move the new cursor past rows it never saw.
      if (!fenced(context)) {
        return false;
      }
      if (!result.ok) {
        return !recordFailure(result.failure);
      }
      lastError = null;
      for (const step of planPage(result.value.events, context.deviceId)) {
        if (step.kind === "apply") {
          applyStep(step);
        } else {
          writeSyncCursor(args.db, step.cursor);
        }
      }
      if (!result.value.hasMore) {
        return true;
      }
    }
    return true;
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
   * `@repo/cloud-contract/captures` states the trade plainly — a lost capture
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
    if (session.kind !== "live" || disposed) {
      return;
    }
    // Captured ONCE. Every step below re-checks it rather than re-reading
    // `session`, so a pass can never finish its work against a session that is
    // no longer the one it started under.
    const context: PassContext = {
      sessionId: session.id,
      client: session.client,
      deviceId: session.credential.deviceId,
    };
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
    switch (session.kind) {
      case "off":
        return { state: "off", cloudUrl: args.cloudUrl };
      case "unauthorized":
        return {
          state: "unauthorized",
          cloudUrl: args.cloudUrl,
          deviceId: session.credential.deviceId,
          detail: session.detail,
        };
      case "live": {
        const state = readSyncState(args.db);
        return {
          state: "paired",
          cloudUrl: args.cloudUrl,
          deviceId: session.credential.deviceId,
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
    if (session.kind !== "live" || disposed) {
      return status();
    }
    if (inflight !== null) {
      // Coalesced rather than queued: a second pass would push the batch the
      // first one is already pushing. One more pass after this one covers
      // whatever arrived while it ran.
      dirty = true;
      await inflight;
      return status();
    }
    inflight = (async () => {
      try {
        for (;;) {
          dirty = false;
          await runPass();
          // Read AFTER the await: every one of these can have moved while the
          // pass ran, which is the whole reason the loop exists.
          if (!dirty || disposed || session.kind !== "live") {
            break;
          }
        }
      } catch (error) {
        lastError = messageOf(error);
        debug(`sync pass failed: ${lastError}`);
      } finally {
        inflight = null;
      }
    })();
    await inflight;
    return status();
  }

  return {
    status,

    enqueue(tx, events) {
      if (session.kind !== "live" || events.length === 0) {
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
      if (session.kind !== "live") {
        return;
      }
      armTimers();
      connect();
      void syncNow();
    },

    async beginPair(request) {
      const deviceName = request.deviceName ?? defaultDeviceName();
      const state = randomBytes(PAIR_STATE_BYTES).toString("hex");
      const verifier = generatePkceVerifier();
      const challenge = await pkceChallengeS256(verifier);
      const url = buildPairApproveUrl(args.cloudUrl, {
        redirect: request.callbackUrl,
        state,
        name: deviceName,
        challenge,
      });
      if (disposed) {
        // Teardown has started: arm nothing and open nothing. The URL is still
        // answered so an in-flight caller gets a coherent reply, but no slot
        // outlives the process — and `completePair` refuses a disposed runtime
        // regardless.
        return { url, opened: false, deviceName, expiresInMs: PENDING_PAIR_TTL_MS };
      }
      pendingPair = { state, verifier, deviceName, expiresAt: Date.now() + PENDING_PAIR_TTL_MS };
      // Awaited, so `opened` is observed rather than assumed — and false is an
      // ordinary answer here, since the caller may have asked for no window at
      // all.
      const opened = request.openBrowser ? await openExternalUrl(url) : false;
      return { url, opened, deviceName, expiresInMs: PENDING_PAIR_TTL_MS };
    },

    async completePair(request) {
      if (disposed) {
        // A callback in flight during ordered shutdown must not redeem over the
        // network and write a credential after teardown. Same answer as an
        // unarmed slot: nothing was completable.
        return { kind: "no-pending" };
      }
      const pending = pendingPair;
      if (pending === null) {
        // Any local page can navigate a browser at this loopback route, so with
        // nothing armed the callback must do nothing at all.
        return { kind: "no-pending" };
      }
      if (Date.now() > pending.expiresAt) {
        pendingPair = null;
        return { kind: "expired" };
      }
      if (!sameState(request.state, pending.state)) {
        // NOT consumed: a wrong state is somebody else's traffic, and throwing
        // the slot away for it would let any local page cancel a pairing the
        // user is halfway through.
        return { kind: "state-mismatch" };
      }
      // CONSUMED BEFORE THE REDEEM. A state that survived its own redeem is a
      // callback URL that can be replayed — out of the browser's history, out
      // of a shoulder-surfed address bar — and the whole point of binding the
      // two is that the pairing this app started happens once.
      pendingPair = null;
      const redeemed = await redeemDevice(
        {
          baseUrl: args.cloudUrl,
          ...(transport.fetch === undefined ? {} : { fetch: transport.fetch }),
        },
        { code: request.code, deviceName: pending.deviceName, verifier: pending.verifier },
      );
      if (disposed) {
        // Teardown ran during the redeem round trip: do not write a credential
        // or open a session after the process was told to stop.
        return { kind: "no-pending" };
      }
      if (!redeemed.ok) {
        return { kind: "refused", failure: redeemed.failure };
      }
      // A fresh pairing starts from a clean slate whether or not one was held
      // before: the outbox and both positions describe an account this device
      // may no longer be talking to. `openSession` below ends the old session,
      // which is what stops a pass still running under it from acking into
      // the queue this reset just emptied.
      closeSocket();
      clearTimers();
      resetSyncState(args.db);
      const credential: DeviceCredential = {
        deviceId: redeemed.value.deviceId,
        credential: redeemed.value.credential,
      };
      writeDeviceCredential(args.dataDir, credential);
      openSession(credential);
      lastError = null;
      reconnectAttempt = 0;
      armTimers();
      connect();
      await syncNow();
      return { kind: "paired", status: status() };
    },

    unpair() {
      closeSession();
      closeSocket();
      clearTimers();
      // An armed approval outlives the credential it was meant to replace
      // otherwise, and "stop syncing this device" followed by a silent re-pair
      // a minute later is not what the button said.
      pendingPair = null;
      clearDeviceCredential(args.dataDir);
      resetSyncState(args.db);
      sessionCounter += 1;
      session = { kind: "off", id: sessionCounter };
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
      pendingPair = null;
      // Cancels the requests in flight. Without it the teardown step's budget
      // is a hope: `await inflight` would wait out every remaining round trip,
      // and the pass would keep writing — the vault included — after the
      // process was told to stop.
      sessionAbort.abort();
      // A pass mid-flight owns a transaction and a request; letting it finish
      // is what keeps the outbox's ack and its push in agreement.
      await inflight?.catch(() => undefined);
    },
  };
}
