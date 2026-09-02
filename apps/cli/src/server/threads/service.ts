// The threads core: one service owning the send policy, the provider event
// ingest (the ONLY writer of provider events), and the queue drain. The two
// laws every method obeys:
//   1. Ingest and send each read state, validate, append, project lifecycle
//      and touch the queue inside ONE synchronous transaction — a completion
//      can never race a send decision, and a subscriber can never observe a
//      notification for state that rolled back (NotificationBuffer flushes
//      after commit).
//   2. Every cross-boundary identity is checked, never assumed: an ingest
//      refuses events naming another thread, and a settle names its turn —
//      the lifecycle CAS makes a late completion for an old turn a logged
//      no-op instead of a wrong-turn transition.
// The one deliberate exception to (1): driver dispatch happens AFTER commit,
// because a scripted driver re-enters ingest synchronously and a transaction
// cannot nest; a dispatch failure is folded back in its own transaction
// (provider/error + run.failed), so a driver crash cannot wedge `starting`.

import {
  approvalPendingInteractionPayloadSchema,
  parseApprovalResolution,
  type ApprovalPendingInteractionPayload,
} from "@repo/domain/pending-interactions";
import { writeTransaction, type DbConnection, type DbTransaction } from "@repo/db/connection";
import {
  appendEventsInTransaction,
  appendSyncedEventsInTransaction,
  turnStartOriginDeviceId,
  type SyncedEventInput,
} from "@repo/db/events";
import { createTurnId } from "@repo/db/ids";
import { NotificationBuffer, type DbNotifier } from "@repo/domain/notifier";
import {
  getPendingInteraction,
  interruptOpenPendingInteractions,
  listAllOpenPendingInteractions,
  listOpenPendingInteractions,
  resolvePendingInteraction,
  type PendingInteractionRow,
} from "@repo/db/pending-interactions";
import {
  claimNextQueuedThreadMessageInTransaction,
  createQueuedThreadMessageInTransaction,
  deleteClaimedQueuedThreadMessageInTransaction,
  listQueuedThreadMessages,
  releaseAllQueuedMessageClaims,
  releaseQueuedMessageClaim,
  type ClaimedQueuedThreadMessageRow,
} from "@repo/db/queued-messages";
import { writeSyncCursor } from "@repo/db/sync-outbox";
import {
  applyThreadLifecycleEventInTransaction,
  archiveThread,
  createThread,
  ensureThreadInTransaction,
  getThread,
  listThreads,
  type CreateThreadInput,
  type ThreadRow,
} from "@repo/db/threads";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { getThreadEventScopeTurnId, threadScope, turnScope } from "@repo/domain/thread-event-scope";
import type { ViewContext } from "@repo/domain/view-context";
import type { ThreadLifecycleEvent } from "@repo/domain/thread-lifecycle";
import type {
  AnswerInteractionRequest,
  CreateThreadRequest,
  GetThreadResponse,
  PendingInteraction,
  SendMessageRequest,
  Thread,
  TimelineQuery,
  TimelineResponse,
} from "@repo/api/local/threads/threads-schema";
import { computeTimelineDelta } from "@repo/api/local/thread-timeline";
import { ThreadTimelineProjector } from "./timeline-projection";
import { TurnDriverUnavailableError, type CreateTurnDriver, type TurnDriver } from "./turn-driver";
import type { ProviderEventSink, TurnDriverStartArgs } from "./turn-driver";

/**
 * Why a send can conflict. `threads-router.ts` switches EXHAUSTIVELY over this
 * union to pick the wire class each one answers, so a member added here breaks
 * there — which is where the answer belongs — rather than becoming a 500.
 */
const SEND_CONFLICT_CODES = ["stale_turn", "archived"] as const;

type SendConflictCode = (typeof SEND_CONFLICT_CODES)[number];

export type SendOutcome =
  | { kind: "started"; turnId: string }
  | { kind: "queued"; queuedMessageId: string }
  | { kind: "not-found" }
  | { kind: "conflict"; error: SendConflictCode; message: string }
  | { kind: "provider-unavailable"; message: string }
  | { kind: "dispatch-failed" };

type SendDecision =
  | {
      kind: "dispatch";
      threadId: string;
      turnId: string;
      text: string;
      viewContext: ViewContext | undefined;
    }
  | { kind: "done"; outcome: SendOutcome };

export type AnswerInteractionOutcome =
  | { kind: "resolved"; interaction: PendingInteraction }
  | { kind: "not-found" }
  | { kind: "already-resolved" }
  | { kind: "invalid-resolution"; message: string };

/** An ingest batch named one thread but carried an event for another. */
export class ThreadEventThreadIdMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`Ingest for thread ${expected} carried an event for thread ${actual}`);
    this.name = "ThreadEventThreadIdMismatchError";
  }
}

/**
 * The cloud's seam into this service, and it lives INSIDE the transaction that
 * writes the events — which is the whole reason it is a seam rather than a
 * call the sync runtime makes afterwards: an event is owed to the account's
 * log exactly when it is in the local one.
 *
 * Absent when this install is not paired, which is the default.
 */
export interface ThreadSyncHooks {
  enqueue(tx: DbTransaction, events: readonly ThreadEvent[]): void;
}

export interface ThreadServiceArgs {
  db: DbConnection;
  notifier: DbNotifier;
  createTurnDriver: CreateTurnDriver;
  sync?: ThreadSyncHooks;
}

function toWireThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    activeTurnId: row.activeTurnId,
    originDocPath: row.originDocPath,
    providerId: row.providerId,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The row's JSON `payload` column against the approval grammar — the ONE place
 * stored bytes become the wire's typed payload. null for bytes that do not
 * match: every consumer's fallback is the same (deny is always answerable), so
 * an unreadable payload costs one card's detail rather than the thread.
 */
function parseStoredApprovalPayload(payloadJson: string): ApprovalPendingInteractionPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  const parsed = approvalPendingInteractionPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function toWirePendingInteraction(row: PendingInteractionRow): PendingInteraction {
  const payload = parseStoredApprovalPayload(row.payload);
  return {
    id: row.id,
    threadId: row.threadId,
    turnId: row.turnId,
    requestKey: row.requestKey,
    status: row.status,
    payload,
    resolution: row.resolution,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}

export class ThreadService implements ProviderEventSink {
  private readonly db: DbConnection;
  private readonly notifier: DbNotifier;
  private readonly driver: TurnDriver;
  private readonly timelines: ThreadTimelineProjector;
  private readonly sync: ThreadSyncHooks | null;

  constructor(args: ThreadServiceArgs) {
    this.db = args.db;
    this.notifier = args.notifier;
    this.sync = args.sync ?? null;
    this.timelines = new ThreadTimelineProjector(args.db);
    this.driver = args.createTurnDriver(this);
  }

  /**
   * Crash recovery, run once per process by the composition root — a method
   * rather than constructor work, because it WRITES: it frees claims,
   * appends settle events, notifies, and enqueues to the outbox, and a side
   * effect that big belongs where the boot order is decided.
   */
  boot(): void {
    // Before the wedged-thread sweep: a claim held by the dead process is
    // invisible to both the queue read and the next drain, so a message left
    // claimed would be lost rather than shown. A swept row does NOT
    // auto-dispatch — the drain fires only when a thread settles idle.
    releaseAllQueuedMessageClaims(this.db);
    this.recoverWedgedThreads();
  }

  /**
   * Append events this DEVICE produced. Every local append goes through here
   * rather than through `appendEventsInTransaction` directly, because the
   * outbox enqueue has to ride the same transaction and a call site that
   * forgot it would drop those events out of sync silently — the failure has
   * no error and no symptom until another device is missing a conversation.
   */
  private appendLocal(tx: DbTransaction, events: readonly ThreadEvent[]): void {
    appendEventsInTransaction(tx, events);
    this.sync?.enqueue(tx, events);
  }

  create(input: CreateThreadRequest): Thread {
    const created: CreateThreadInput = {};
    if (input.title !== undefined) created.title = input.title;
    if (input.originDocPath !== undefined) created.originDocPath = input.originDocPath;
    return toWireThread(createThread(this.db, this.notifier, created));
  }

  list(): Thread[] {
    return listThreads(this.db).map(toWireThread);
  }

  get(threadId: string): GetThreadResponse | null {
    const thread = getThread(this.db, threadId);
    if (thread === null) {
      return null;
    }
    return {
      thread: toWireThread(thread),
      pendingInteractions: listOpenPendingInteractions(this.db, threadId).map(
        toWirePendingInteraction,
      ),
      queuedMessages: listQueuedThreadMessages(this.db, threadId).map((row) => ({
        id: row.id,
        text: row.text,
        createdAt: row.createdAt,
      })),
    };
  }

  listInteractions(threadId: string | undefined): PendingInteraction[] {
    const rows =
      threadId === undefined
        ? listAllOpenPendingInteractions(this.db)
        : listOpenPendingInteractions(this.db, threadId);
    return rows.map(toWirePendingInteraction);
  }

  archive(threadId: string): Thread | null {
    const archived = archiveThread(this.db, this.notifier, threadId);
    return archived === null ? null : toWireThread(archived);
  }

  send(request: SendMessageRequest): SendOutcome {
    const buffer = new NotificationBuffer();
    const decision = writeTransaction(this.db, (tx) =>
      this.resolveSendInTransaction(tx, request, buffer),
    );
    buffer.flushTo(this.notifier);
    if (decision.kind === "dispatch") {
      return this.dispatchTurn(decision);
    }
    return decision.outcome;
  }

  /** The whole read-decide-write of a send under one lock: status, turn
   *  identity, queue insert or turn preparation. */
  private resolveSendInTransaction(
    tx: DbTransaction,
    request: SendMessageRequest,
    buffer: NotificationBuffer,
  ): SendDecision {
    const thread = getThread(tx, request.threadId);
    if (thread === null) {
      return { kind: "done", outcome: { kind: "not-found" } };
    }
    if (thread.archivedAt !== null) {
      return {
        kind: "done",
        outcome: { kind: "conflict", error: "archived", message: "The thread is archived" },
      };
    }
    if (request.expectedTurnId !== undefined && request.expectedTurnId !== thread.activeTurnId) {
      return {
        kind: "done",
        outcome: {
          kind: "conflict",
          error: "stale_turn",
          message: "The turn this message addressed is no longer the open one",
        },
      };
    }

    switch (thread.status) {
      case "idle":
      case "error":
        return this.prepareTurnInTransaction(tx, thread, request.text, request.viewContext, buffer);
      case "active":
      case "starting":
      case "stopping":
        return this.queueInTransaction(tx, thread.id, request.text, buffer);
    }
  }

  /**
   * A QUEUED MESSAGE CARRIES NO VIEW CONTEXT, and the request's is dropped
   * here rather than stored. A queued send drains when the running turn
   * settles — minutes later — so the screen it describes is one the user has
   * long since left, and the tidy-looking answer ("context is per message, so
   * every message carries its own") is the one that adds a column to
   * `queued_thread_messages` and fills it with a knowably stale claim. A view
   * context earns its immunity to staleness by being consumed immediately;
   * storing one for later is exactly the property being given away. The client
   * still SENDS it — which mode a send lands in is this transaction's decision,
   * not the caller's — so the drop belongs here, once.
   */
  private queueInTransaction(
    tx: DbTransaction,
    threadId: string,
    text: string,
    buffer: NotificationBuffer,
  ): SendDecision {
    const queued = createQueuedThreadMessageInTransaction(tx, { threadId, text });
    buffer.notifyThread(threadId, ["queue-changed"]);
    return { kind: "done", outcome: { kind: "queued", queuedMessageId: queued.id } };
  }

  /** run.preparing + the recorded request, atomically; dispatch happens after
   *  the caller's commit. Takes the loaded ROW rather than an id: the write
   *  mode the dispatch carries has to be the one this transaction read, not
   *  one a second query could observe after the thread moved. */
  private prepareTurnInTransaction(
    tx: DbTransaction,
    thread: ThreadRow,
    text: string,
    viewContext: ViewContext | undefined,
    buffer: NotificationBuffer,
  ): SendDecision {
    const threadId = thread.id;
    const outcome = applyThreadLifecycleEventInTransaction(tx, {
      threadId,
      event: { type: "run.preparing" },
    });
    if (!outcome.applied) {
      // The thread moved out from under the caller's view of it — the drain's
      // case, where the settle and the claim are separated by an archive. A
      // send cannot reach here: it read this row in this transaction.
      return {
        kind: "done",
        outcome: {
          kind: "conflict",
          error: "stale_turn",
          message: `Cannot start a turn: ${outcome.detail}`,
        },
      };
    }
    buffer.notifyThread(threadId, ["status-changed"]);
    const requested: Extract<ThreadEvent, { type: "client/turn/requested" }> = {
      type: "client/turn/requested",
      threadId,
      text,
      scope: threadScope(),
    };
    if (viewContext !== undefined) requested.viewContext = viewContext;
    this.appendLocal(tx, [requested]);
    buffer.notifyThread(threadId, ["events-appended"]);
    return {
      kind: "dispatch",
      threadId,
      turnId: createTurnId(),
      text,
      viewContext,
    };
  }

  private dispatchTurn(decision: Extract<SendDecision, { kind: "dispatch" }>): SendOutcome {
    const start: TurnDriverStartArgs = {
      threadId: decision.threadId,
      turnId: decision.turnId,
      text: decision.text,
    };
    if (decision.viewContext !== undefined) start.viewContext = decision.viewContext;
    try {
      this.driver.startTurn(start);
    } catch (error) {
      this.recordDispatchFailure(decision.threadId, error);
      return error instanceof TurnDriverUnavailableError
        ? { kind: "provider-unavailable", message: error.message }
        : { kind: "dispatch-failed" };
    }
    return { kind: "started", turnId: decision.turnId };
  }

  /** ANY dispatch throw settles the run: provider/error recorded and the
   *  thread lands in `error`, never wedged in `starting`. */
  private recordDispatchFailure(threadId: string, cause: unknown): void {
    this.failTurnlessRun(threadId, cause instanceof Error ? cause.message : String(cause));
  }

  /**
   * Settle a run that never reached `turn/started`. It is NOT routed through
   * ingest: a bare thread-scoped `provider/error` projects no lifecycle event,
   * so the thread would stay wedged in `starting`. The `run.failed` names no
   * turn, and matching against a null activeTurnId is what stops it killing a
   * run that did start.
   */
  private failTurnlessRun(threadId: string, message: string): void {
    const buffer = new NotificationBuffer();
    writeTransaction(this.db, (tx) => {
      this.appendLocal(tx, [{ type: "provider/error", threadId, message, scope: threadScope() }]);
      buffer.notifyThread(threadId, ["events-appended"]);
      const outcome = applyThreadLifecycleEventInTransaction(tx, {
        threadId,
        event: { type: "run.failed", turnId: null },
      });
      if (outcome.applied) {
        buffer.notifyThread(threadId, ["status-changed"]);
      }
    });
    buffer.flushTo(this.notifier);
  }

  timeline(query: TimelineQuery): TimelineResponse | null {
    if (getThread(this.db, query.threadId) === null) {
      return null;
    }
    const full = this.timelines.full(query.threadId);
    // A delta is served only for a base this log reconstructs exactly; a
    // client ahead of the log (a rebuilt db) gets the full timeline instead.
    if (query.afterSequence === undefined || query.afterSequence > full.maxSequence) {
      return { kind: "full", timeline: full };
    }
    const base = this.timelines.prefix(query.threadId, query.afterSequence);
    return { kind: "delta", delta: computeTimelineDelta(base, full) };
  }

  answerInteraction(request: AnswerInteractionRequest): AnswerInteractionOutcome {
    const existing = getPendingInteraction(this.db, request.interactionId);
    if (existing === null || existing.threadId !== request.threadId) {
      return { kind: "not-found" };
    }
    const invalid = invalidResolutionMessage(existing.payload, request.resolution);
    if (invalid !== null) {
      return { kind: "invalid-resolution", message: invalid };
    }
    const outcome = resolvePendingInteraction(this.db, this.notifier, {
      id: request.interactionId,
      threadId: request.threadId,
      resolution: request.resolution,
    });
    switch (outcome.kind) {
      case "resolved": {
        const interaction = toWirePendingInteraction(outcome.interaction);
        // AFTER the row is resolved: the driver answers the provider process
        // from the recorded resolution, so a crash between the two leaves a
        // resolved row (the truth) and a provider request the turn-end
        // timeout settles.
        this.driver.onInteractionResolved?.(interaction);
        return { kind: "resolved", interaction };
      }
      case "already-resolved":
        return { kind: "already-resolved" };
      case "not-found":
        return { kind: "not-found" };
    }
  }

  /**
   * The one return path for provider events, whatever produced them — a real
   * adapter, the scripted driver, or this service's own crash recovery.
   * Append, lifecycle projection and the queue claim share one transaction;
   * the claimed drain dispatches after commit through the same prepare flow a
   * send uses.
   *
   * Two other paths append, and neither is a provider report:
   * `prepareTurnInTransaction` records the user's own request, and
   * `failTurnlessRun` records a run that died before any turn existed. Both go
   * through `appendLocal`, so the outbox enqueue rides their transaction too.
   */
  ingestProviderEvents(threadId: string, events: readonly ThreadEvent[]): void {
    this.ingest({ origin: "local", threadId, events });
  }

  /**
   * Events another device wrote, arriving through the account's merged log.
   *
   * The SAME ingest, marked with its origin — a second append path here would
   * be a second answer to thread lifecycle, which is the class of duplication
   * this repo's structural guards exist to catch. What the origin changes is
   * exactly three things, and each is forced:
   *
   *  - the thread row is CREATED if this device has never seen it, with the id
   *    the log gave it, because a synced thread's identity is the account's;
   *  - nothing is enqueued back to the outbox, or the two devices would echo
   *    one conversation at each other forever;
   *  - a settle does NOT drain this device's queue. The turn ran elsewhere,
   *    and a queued message here is one this user typed on THIS machine for a
   *    thread they are not driving — starting it because a remote turn ended
   *    would put two agents on one thread.
   */
  applySyncedEvents(args: {
    threadId: string;
    rows: readonly SyncedEventInput[];
    cursor: number;
  }): void {
    this.ingest({
      origin: "remote",
      threadId: args.threadId,
      rows: args.rows,
      cursor: args.cursor,
    });
  }

  private ingest(
    args:
      | { origin: "local"; threadId: string; events: readonly ThreadEvent[] }
      | { origin: "remote"; threadId: string; rows: readonly SyncedEventInput[]; cursor: number },
  ): void {
    const { threadId } = args;
    const events = args.origin === "remote" ? args.rows.map((row) => row.event) : args.events;
    const mismatched = events.find((event) => event.threadId !== threadId);
    if (mismatched !== undefined) {
      throw new ThreadEventThreadIdMismatchError(threadId, mismatched.threadId);
    }
    if (events.length === 0) {
      return;
    }
    const buffer = new NotificationBuffer();
    const drains: ClaimedQueuedThreadMessageRow[] = [];
    writeTransaction(this.db, (tx) => {
      // What lifecycle actually projects over: the rows that LANDED. For a
      // local batch that is all of them; for a synced one it is the input
      // minus whatever this database already held, which is what makes a
      // re-pair's full replay a no-op rather than a status flap.
      let projected: readonly ThreadEvent[] = events;
      if (args.origin === "remote") {
        if (ensureThreadInTransaction(tx, threadId).created) {
          buffer.notifyThread(threadId, ["thread-created"]);
        }
        const landed = appendSyncedEventsInTransaction(tx, args.rows);
        projected = landed.applied.map((row) => row.event);
        // IN THIS TRANSACTION, which is what makes a pulled event land
        // exactly once — advancing the cursor as a second write leaves a
        // window where a crash replays the page into duplicate rows. And it
        // advances even when nothing landed: the point of the cursor is that
        // this device has SEEN the row, not that the row was new.
        writeSyncCursor(tx, args.cursor);
        if (projected.length === 0) {
          return;
        }
      } else {
        this.appendLocal(tx, events);
      }
      buffer.notifyThread(threadId, ["events-appended"]);
      for (const event of projected) {
        const lifecycleEvent = lifecycleEventFor(event);
        if (lifecycleEvent === null) {
          continue;
        }
        const outcome = applyThreadLifecycleEventInTransaction(tx, {
          threadId,
          event: lifecycleEvent,
        });
        if (!outcome.applied) {
          // A late completion for a superseded turn is expected traffic —
          // logged, never thrown, and it settles nothing.
          console.warn(
            `thread ${threadId}: ${lifecycleEvent.type} not applied (${outcome.reason}): ${outcome.detail}`,
          );
          continue;
        }
        buffer.notifyThread(threadId, ["status-changed"]);
        if (outcome.thread.status === "idle" && args.origin === "local") {
          const claimed = claimNextQueuedThreadMessageInTransaction(tx, threadId);
          if (claimed !== null) {
            buffer.notifyThread(threadId, ["queue-changed"]);
            drains.push(claimed);
          }
        }
      }
    });
    buffer.flushTo(this.notifier);
    for (const claimed of drains) {
      this.dispatchQueuedMessage(threadId, claimed);
    }
  }

  /**
   * THE QUEUE ROW AND ITS REQUEST EVENT ARE ONE FACT, so they are one
   * transaction. Deleting after the dispatch instead left a window where the
   * `client/turn/requested` was already in the log — and in the sync outbox —
   * while the row was merely claimed: a driver that refuses to start released
   * it, and the next drain appended the user's message a second time, on this
   * device and on every paired one.
   *
   * A dispatch failure therefore needs no release. `recordDispatchFailure`
   * lands the thread in `error` with the reason recorded, which is the honest
   * account of what happened to this message.
   */
  private dispatchQueuedMessage(threadId: string, claimed: ClaimedQueuedThreadMessageRow): void {
    const buffer = new NotificationBuffer();
    const decision = writeTransaction(this.db, (tx): SendDecision => {
      const thread = getThread(tx, threadId);
      if (thread === null) {
        return { kind: "done", outcome: { kind: "not-found" } };
      }
      // No view context: the row never held one — see queueInTransaction.
      const prepared = this.prepareTurnInTransaction(tx, thread, claimed.text, undefined, buffer);
      if (prepared.kind === "dispatch") {
        deleteClaimedQueuedThreadMessageInTransaction(tx, claimed);
        buffer.notifyThread(threadId, ["queue-changed"]);
      }
      return prepared;
    });
    buffer.flushTo(this.notifier);
    if (decision.kind !== "dispatch") {
      // Prepare appended nothing (e.g. the thread was archived between the
      // settle and the drain): the claim is released, never silently consumed.
      releaseQueuedMessageClaim(this.db, this.notifier, claimed);
      return;
    }
    this.dispatchTurn(decision);
  }

  /**
   * Crash recovery, run from `boot()`: this process just booted, so no
   * turn driver claim is live — any thread still marked running is an orphan
   * of a previous process. run.failed is legal from starting, active and
   * stopping alike, and it names the orphaned turn so the CAS matches by
   * construction.
   *
   * "OF A PREVIOUS PROCESS" IS NOW A QUESTION, not an assumption. A synced
   * thread can be active because ANOTHER DEVICE started a turn on it, and that
   * device's provider is very much alive — declaring it failed here would
   * append a fabricated failure and, worse, push it back through the account's
   * log to the machine where the work is genuinely still running. Only the
   * process that owns a provider may say the provider died, so the turn's own
   * `turn/started` row is asked who wrote it.
   *
   * The residual, stated: a device that never comes back leaves the thread
   * active here until it does. That is the same trade in the other direction —
   * this process cannot distinguish "still working" from "gone" across a
   * network, and the owner's own recovery settles it and syncs the settle back.
   *
   * A RECOVERED TURN IS COMPLETED, NOT JUST FAILED ON THE ROW. The timeline is
   * a pure fold and `turn/completed` is its only writer of a turn's status, so
   * a recovery that appended `provider/error` alone left the turn row rendering
   * "working" forever, beside a thread header saying error — here and on every
   * device the log reaches, since `provider/error` projects no lifecycle at all.
   */
  private recoverWedgedThreads(): void {
    const message = "The server restarted while this turn was running";
    for (const thread of listThreads(this.db)) {
      if (
        thread.status !== "starting" &&
        thread.status !== "active" &&
        thread.status !== "stopping"
      ) {
        continue;
      }
      const activeTurnId = thread.activeTurnId;
      if (
        activeTurnId !== null &&
        turnStartOriginDeviceId(this.db, {
          threadId: thread.id,
          turnId: activeTurnId,
        }) !== null
      ) {
        continue;
      }
      if (activeTurnId === null) {
        // A crash between run.preparing and run.started: there is no turn to
        // complete, so the failure is thread-scoped and names no turn — and
        // the null match means a STARTED run can never be killed by it.
        this.failTurnlessRun(thread.id, message);
      } else {
        this.ingestProviderEvents(thread.id, [
          { type: "provider/error", threadId: thread.id, message, scope: threadScope() },
          {
            type: "turn/completed",
            threadId: thread.id,
            status: "failed",
            scope: turnScope(activeTurnId),
          },
        ]);
      }
      // The provider requests behind these rows died with the old process:
      // settle them as interrupted so no orphan answerable rows survive a
      // restart — a restarted provider raises FRESH rows (new request keys),
      // never duplicates of these.
      interruptOpenPendingInteractions(this.db, this.notifier, thread.id);
    }
  }
}

/**
 * Refuse an answer the shared approval grammar rejects — the SAME parse the
 * runtime's answer path runs, so a resolution this gate passes can never be
 * silently denied downstream. Rows whose payload is not a parseable approval
 * skip the check.
 */
function invalidResolutionMessage(payloadJson: string, resolution: string): string | null {
  const payload = parseStoredApprovalPayload(payloadJson);
  if (payload === null) {
    return null;
  }
  const parsed = parseApprovalResolution(resolution, payload);
  return parsed.ok ? null : parsed.reason;
}

function lifecycleEventFor(event: ThreadEvent): ThreadLifecycleEvent | null {
  const turnId = getThreadEventScopeTurnId(event.scope) ?? null;
  switch (event.type) {
    case "turn/started":
      // The scope policy makes a turn-less turn/started unparseable; the null
      // branch only guards a future policy change.
      return turnId === null ? null : { type: "run.started", turnId };
    case "turn/completed":
      // An interrupted turn still SETTLED — run.succeeded lands it idle from
      // active/starting/stopping alike; only a failed turn reads as an error.
      return event.status === "failed"
        ? { type: "run.failed", turnId }
        : { type: "run.succeeded", turnId };
    default:
      return null;
  }
}
