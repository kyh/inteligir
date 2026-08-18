// Cloud thread sync: the loop that carries this device's thread events to the
// account's merged log and applies everyone else's back.
//
// SYNC IS OFF UNTIL SOMEONE PAIRS, and the credential file IS the switch.
// There is no second "enabled" flag, because two values that must agree are
// two values that can disagree — a flag off beside a live credential leaves a
// working credential nothing uses, and a flag on beside none is a promise no
// loop can keep. With no credential this object opens no socket, arms no
// timer and makes no request; `status()` answers `off` and every verb but
// `pair` is a no-op.
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

import { CLAIM_DEFAULT_LIMIT, type CaptureRow } from "@repo/cloud-contract/captures";
import type { CloudErrorCode } from "@repo/cloud-contract/errors";
import { PULL_DEFAULT_LIMIT, type SyncEventRow } from "@repo/cloud-contract/sync";
import type { DbConnection, DbTransaction } from "@repo/db/connection";
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
import type { CloudPairRequest, CloudStatusResponse } from "@repo/server-contract/cloud";
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
import { VaultServiceError, type VaultService } from "../vault/vault-service";

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

/** Where a claimed capture lands. One note rather than a dated one: a daily
 *  note is a vault convention this product has not chosen yet, and inventing
 *  one here would put the choice in the sync client. */
export const CAPTURE_INBOX_PATH = "Inbox.md";

/** How long an applied capture id is remembered. The only window it has to
 *  cover is a lapsed claim being handed to this device again, which the
 *  contract bounds at five minutes — a week is slack, not a requirement. */
const APPLIED_CAPTURE_RETENTION_MS = 7 * 24 * 60 * 60_000;

/**
 * The one-transaction ingest, as this runtime needs it. Implemented by
 * `ThreadService`, which is the ONLY writer of thread events — a second append
 * path here would be a second answer to thread lifecycle.
 */
export interface SyncedEventSink {
  applySyncedEvents(args: {
    threadId: string;
    events: readonly ThreadEvent[];
    /** The log position these events settle, written in the SAME transaction
     *  that appends them. */
    cursor: number;
  }): void;
}

type PairOutcome =
  | { kind: "paired"; status: CloudStatusResponse }
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
  /** null disables the poll timer, the push debounce AND the socket, leaving
   *  `syncNow` the only trigger — what a deterministic suite needs. */
  pollIntervalMs?: number | null;
}

/**
 * The slice of the vault a claimed capture needs. Narrow on purpose: this
 * runtime writes exactly ONE note, and handing it the whole service is how a
 * sync client quietly becomes a second writer of the vault.
 */
export type CaptureVault = Pick<VaultService, "read" | "writeIfUnchanged" | "writeGuarded">;

export interface CloudRuntimeArgs {
  db: DbConnection;
  /** Where the credential lives; also this install's identity. */
  dataDir: string;
  cloudUrl: string;
  /** Where a claimed capture is written. */
  vault: CaptureVault;
  transport?: CloudTransport;
  onDebug?: (message: string) => void;
}

export interface CloudRuntime {
  status(): CloudStatusResponse;
  /** The outbox hook the thread service calls inside its append transaction. */
  enqueue(tx: DbTransaction, events: readonly ThreadEvent[]): void;
  /** The cursor hook, in the transaction that applies a pulled batch. */
  recordCursor(tx: DbTransaction, cursor: number): void;
  /** Late-bound: the sink is built after this runtime, because the thread
   *  service needs `enqueue` at construction. */
  attach(sink: SyncedEventSink): void;
  start(): void;
  pair(request: CloudPairRequest): Promise<PairOutcome>;
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

type Session =
  | { kind: "off" }
  | { kind: "live"; credential: DeviceCredential; client: CloudClient }
  | { kind: "unauthorized"; credential: DeviceCredential; detail: string };

export function createCloudRuntime(args: CloudRuntimeArgs): CloudRuntime {
  const transport = args.transport ?? {};
  const debug = args.onDebug ?? ((message: string) => console.error(`cloud: ${message}`));
  const openSocket = transport.openSocket ?? null;
  const pollIntervalMs =
    transport.pollIntervalMs === undefined ? POLL_INTERVAL_MS : transport.pollIntervalMs;

  let sink: SyncedEventSink | null = null;
  let session: Session = { kind: "off" };
  let socket: CloudSocket | null = null;
  let connected = false;
  let lastError: string | null = null;
  let disposed = false;

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let inflight: Promise<void> | null = null;
  let dirty = false;

  function openSession(credential: DeviceCredential): void {
    session = {
      kind: "live",
      credential,
      client: createCloudClient({
        baseUrl: args.cloudUrl,
        credential: credential.credential,
        ...(transport.fetch === undefined ? {} : { fetch: transport.fetch }),
      }),
    };
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
    socket = openSocket({
      baseUrl: args.cloudUrl,
      credential,
      // This process owns the vault and drives the agent, so it is the machine
      // a `desktop`-lane dispatch is addressed to. Answering one is a later
      // round's work; saying what this device IS is not.
      platform: "desktop",
      onOpen: () => {
        connected = true;
        reconnectAttempt = 0;
      },
      onPing: (ping) => {
        // Every frame is invalidation-only, so all three mean the same thing
        // here: ask the server what changed. A `dispatch` for a thread this
        // device has not been told to run still wants pulling, so the thread
        // shows up rather than existing only in the cloud.
        debug(`ping: ${ping.type}`);
        void syncNow();
      },
      onClose: (code) => {
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
      session = { kind: "unauthorized", credential: session.credential, detail: failure.message };
    }
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
  async function drain(client: CloudClient): Promise<boolean> {
    for (let round = 0; round < MAX_PUSH_BATCHES_PER_PASS; round += 1) {
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
      const result = await client.push(batch.request);
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
  type PlanStep =
    | { kind: "apply"; threadId: string; events: ThreadEvent[]; cursor: number }
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
      if (last?.kind === "apply" && last.threadId === row.threadId) {
        last.events.push(event.data);
        last.cursor = row.seq;
        continue;
      }
      steps.push({ kind: "apply", threadId: row.threadId, events: [event.data], cursor: row.seq });
    }
    return steps;
  }

  function applyStep(step: Extract<PlanStep, { kind: "apply" }>): void {
    const target = sink;
    if (target === null) {
      throw new Error("cloud sync has no ingest sink attached");
    }
    try {
      target.applySyncedEvents({
        threadId: step.threadId,
        events: step.events,
        cursor: step.cursor,
      });
      return;
    } catch (error) {
      debug(`applying ${step.events.length} synced event(s) failed: ${messageOf(error)}`);
    }
    // One event the local log refuses — a turn-content event whose
    // `turn/started` this device never received, which is what pairing
    // mid-turn produces — must not take the rest of the group with it. Retried
    // one at a time so the group's good events still land.
    for (const event of step.events) {
      try {
        target.applySyncedEvents({ threadId: step.threadId, events: [event], cursor: step.cursor });
      } catch (individual) {
        debug(`skipping a synced ${event.type}: ${messageOf(individual)}`);
      }
    }
    // Every event was tried, so the cursor moves whatever happened — otherwise
    // the next pass replays the same refusals forever.
    writeSyncCursor(args.db, step.cursor);
  }

  /** Page the log forward and apply everything this device did not write.
   *  Returns false when the session ended. */
  async function pullAndApply(client: CloudClient, deviceId: string): Promise<boolean> {
    for (let page = 0; page < MAX_PULL_PAGES_PER_PASS; page += 1) {
      const cursor = readSyncState(args.db).cursor;
      const result = await client.pull({ afterSeq: cursor, limit: PULL_DEFAULT_LIMIT });
      if (!result.ok) {
        return !recordFailure(result.failure);
      }
      lastError = null;
      for (const step of planPage(result.value.events, deviceId)) {
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
   * ack. The order is the guarantee: the vault write commits, THEN the id is
   * recorded, THEN the claim is acked — so a crash costs a repeat (which the
   * ledger absorbs) rather than a capture nobody ever wrote.
   */
  async function applyCaptures(client: CloudClient): Promise<boolean> {
    const claimed = await client.claimCaptures(CLAIM_DEFAULT_LIMIT);
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
      const written = await appendToInbox(toWrite);
      if (!written) {
        // Nothing recorded and nothing acked: the claim lapses and the inbox
        // hands these to whoever claims next.
        return true;
      }
      recordAppliedCaptures(
        args.db,
        toWrite.map((capture) => capture.id),
        Date.now(),
      );
    }
    const acked = await client.ackCaptures({
      claimToken: claimed.value.claimToken,
      ids: captures.map((capture) => capture.id),
    });
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

  async function appendToInbox(captures: readonly CaptureRow[]): Promise<boolean> {
    const addition = captures.map(inboxBullet).join("");
    try {
      const current = await args.vault.read(CAPTURE_INBOX_PATH);
      const separator = current.content === "" || current.content.endsWith("\n") ? "" : "\n";
      const result = await args.vault.writeIfUnchanged(
        CAPTURE_INBOX_PATH,
        current.content,
        `${current.content}${separator}${addition}`,
      );
      if (!result.applied) {
        debug(`${CAPTURE_INBOX_PATH} changed under the capture write; retrying next pass`);
        return false;
      }
      return true;
    } catch (error) {
      if (!(error instanceof VaultServiceError) || error.code !== "not_found") {
        debug(`could not write ${CAPTURE_INBOX_PATH}: ${messageOf(error)}`);
        return false;
      }
    }
    const created = await args.vault.writeGuarded(CAPTURE_INBOX_PATH, `# Inbox\n\n${addition}`, {
      ifAbsent: true,
    });
    if (!created.applied) {
      debug(`${CAPTURE_INBOX_PATH} appeared under the capture write; retrying next pass`);
      return false;
    }
    return true;
  }

  async function runPass(): Promise<void> {
    if (session.kind !== "live") {
      return;
    }
    const { client, credential } = session;
    if (!(await drain(client))) {
      return;
    }
    if (!(await pullAndApply(client, credential.deviceId))) {
      return;
    }
    if (!(await applyCaptures(client))) {
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

    recordCursor(tx, cursor) {
      writeSyncCursor(tx, cursor);
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

    async pair(request) {
      const redeemed = await redeemDevice(
        {
          baseUrl: args.cloudUrl,
          ...(transport.fetch === undefined ? {} : { fetch: transport.fetch }),
        },
        { code: request.code, deviceName: request.deviceName },
      );
      if (!redeemed.ok) {
        return { kind: "refused", failure: redeemed.failure };
      }
      // A fresh pairing starts from a clean slate whether or not one was held
      // before: the outbox and both positions describe an account this device
      // may no longer be talking to.
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
      closeSocket();
      clearTimers();
      clearDeviceCredential(args.dataDir);
      resetSyncState(args.db);
      session = { kind: "off" };
      lastError = null;
      reconnectAttempt = 0;
      return status();
    },

    syncNow,

    async dispose() {
      disposed = true;
      clearTimers();
      closeSocket();
      // A pass mid-flight owns a transaction and a request; letting it finish
      // is what keeps the outbox's ack and its push in agreement.
      await inflight?.catch(() => undefined);
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One capture, one bullet. Continuation lines are indented so a multi-line
 *  capture stays inside its own list item instead of ending the list. */
function inboxBullet(capture: CaptureRow): string {
  return `- ${capture.text.replaceAll("\n", "\n  ")}\n`;
}
