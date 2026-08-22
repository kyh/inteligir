// The threads core: one service owning the send modes, the provider event
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

import type { AgentWriteMode } from "@repo/domain/agent-write-mode";
import {
  approvalPendingInteractionPayloadSchema,
  parseApprovalResolution,
  type ApprovalPendingInteractionPayload,
} from "@repo/domain/pending-interactions";
import type { DbConnection, DbTransaction } from "@repo/db/connection";
import {
  appendEventsInTransaction,
  appendSyncedEventsInTransaction,
  turnStartOriginDeviceId,
  type SyncedEventInput,
} from "@repo/db/events";
import { createTurnId } from "@repo/db/ids";
import { NotificationBuffer, type DbNotifier } from "@repo/domain/notifier";
import {
  countOpenPendingInteractionsByThread,
  getPendingInteraction,
  interruptOpenPendingInteractions,
  listAllOpenPendingInteractions,
  listOpenPendingInteractions,
  resolvePendingInteraction,
  type PendingInteractionRow,
} from "@repo/db/pending-interactions";
import { countPendingProposalsByThread } from "@repo/db/proposals";
import {
  claimNextQueuedThreadMessageInTransaction,
  countQueuedThreadMessagesByThread,
  createQueuedThreadMessageInTransaction,
  deleteClaimedQueuedThreadMessage,
  listQueuedThreadMessages,
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
  listThreadsByOriginDoc,
  type CreateThreadInput,
  type ThreadRow,
} from "@repo/db/threads";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { getThreadEventScopeTurnId, threadScope } from "@repo/domain/thread-event-scope";
import type { ViewContext } from "@repo/domain/view-context";
import type { ThreadLifecycleEvent } from "@repo/domain/thread-lifecycle";
import type {
  AnswerInteractionRequest,
  CreateThreadRequest,
  DocThreadActivity,
  GetThreadResponse,
  PendingInteraction,
  SendMessageRequest,
  Thread,
  TimelineQuery,
  TimelineResponse,
} from "@repo/server-contract/threads";
import type { ApiErrorCode } from "@repo/server-contract/errors";
import { computeTimelineDelta } from "@repo/server-contract/thread-timeline";
import { ThreadTimelineProjector } from "./timeline-projection";
import { TurnDriverUnavailableError, type CreateTurnDriver, type TurnDriver } from "./turn-driver";
import type { ProviderEventSink, TurnDriverStartArgs, TurnDriverSteerArgs } from "./turn-driver";

/**
 * Why a send can conflict — a SUBSET of the API's vocabulary, held against it
 * rather than restated. All three answer one status today, and the route reads
 * that status out of the contract's map by code, so the day one of them stops
 * agreeing the handler stops compiling instead of quietly answering the wrong
 * one.
 */
const SEND_CONFLICT_CODES = [
  "stale_turn",
  "not_steerable",
  "archived",
] as const satisfies readonly ApiErrorCode[];

type SendConflictCode = (typeof SEND_CONFLICT_CODES)[number];

export type SendOutcome =
  | { kind: "started"; turnId: string }
  | { kind: "steered"; turnId: string }
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
      writeMode: AgentWriteMode;
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
 * Absent when this install is not paired, which is the default (issue #572).
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
    originAnchor: row.originAnchor,
    providerId: row.providerId,
    writeMode: row.writeMode,
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
    if (input.originAnchor !== undefined) created.originAnchor = input.originAnchor;
    if (input.providerId !== undefined) created.providerId = input.providerId;
    if (input.writeMode !== undefined) created.writeMode = input.writeMode;
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

  /**
   * Every thread bound to a doc, archived included — a chip for an archived
   * thread is what carries the dismiss affordance.
   *
   * THREE queries, whatever the vault holds: the bound threads by their own
   * index, then one grouped count each. The open note re-runs this on every
   * thread invalidation, so the shape that scanned all threads and then asked
   * two questions per row would grow with the vault and fire while an agent
   * streams.
   */
  listByDoc(docPath: string): DocThreadActivity[] {
    const bound = listThreadsByOriginDoc(this.db, docPath);
    const ids = bound.map((row) => row.id);
    const interactions = countOpenPendingInteractionsByThread(this.db, ids);
    const queued = countQueuedThreadMessagesByThread(this.db, ids);
    const proposals = countPendingProposalsByThread(this.db, ids);
    return bound.map((row) => ({
      thread: toWireThread(row),
      openInteractionCount: interactions.get(row.id) ?? 0,
      queuedCount: queued.get(row.id) ?? 0,
      pendingProposalCount: proposals.get(row.id) ?? 0,
    }));
  }

  archive(threadId: string): Thread | null {
    const archived = archiveThread(this.db, this.notifier, threadId);
    return archived === null ? null : toWireThread(archived);
  }

  send(request: SendMessageRequest): SendOutcome {
    const buffer = new NotificationBuffer();
    const decision = this.db.transaction(
      (tx) => this.resolveSendInTransaction(tx, request, buffer),
      { behavior: "immediate" },
    );
    buffer.flushTo(this.notifier);
    if (decision.kind === "dispatch") {
      return this.dispatchTurn(decision);
    }
    return decision.outcome;
  }

  /** The whole read-decide-write of a send under one lock: status, turn
   *  identity, steer acceptance, queue insert or turn preparation. */
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
      case "active": {
        if (request.mode === "queue-if-active") {
          return this.queueInTransaction(tx, thread.id, request.text, buffer);
        }
        // A steer names the turn it joins, ALWAYS. An unguarded steer is not a
        // client saying "whichever turn is open" — it is a client that believed
        // the thread was idle, and injecting its text into a turn it has never
        // seen (another window's, or one that started between its render and
        // its send) puts words in a conversation the user is not having. The
        // 409 sends it back to re-read and decide again.
        if (request.expectedTurnId === undefined) {
          return {
            kind: "done",
            outcome: {
              kind: "conflict",
              error: "stale_turn",
              message: "A turn is already running; steering it must name it",
            },
          };
        }
        if (thread.activeTurnId !== null) {
          const steer: TurnDriverSteerArgs = {
            threadId: thread.id,
            turnId: thread.activeTurnId,
            text: request.text,
          };
          if (request.viewContext !== undefined) steer.viewContext = request.viewContext;
          if (this.driver.steerTurn(steer)) {
            const steered: Extract<ThreadEvent, { type: "client/turn/requested" }> = {
              type: "client/turn/requested",
              threadId: thread.id,
              text: request.text,
              kind: "steer",
              scope: threadScope(),
            };
            if (request.viewContext !== undefined) steered.viewContext = request.viewContext;
            this.appendLocal(tx, [steered]);
            buffer.notifyThread(thread.id, ["events-appended"]);
            return { kind: "done", outcome: { kind: "steered", turnId: thread.activeTurnId } };
          }
        }
        return {
          kind: "done",
          outcome: {
            kind: "conflict",
            error: "not_steerable",
            message: "The active turn cannot be steered",
          },
        };
      }
      case "starting":
      case "stopping": {
        if (request.mode === "queue-if-active") {
          return this.queueInTransaction(tx, thread.id, request.text, buffer);
        }
        return {
          kind: "done",
          outcome: {
            kind: "conflict",
            error: "not_steerable",
            message: `A ${thread.status} thread has no steerable turn`,
          },
        };
      }
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
      return {
        kind: "done",
        outcome: {
          kind: "conflict",
          error: "not_steerable",
          message: `Cannot start a turn: ${outcome.detail}`,
        },
      };
    }
    buffer.notifyThread(threadId, ["status-changed"]);
    const requested: Extract<ThreadEvent, { type: "client/turn/requested" }> = {
      type: "client/turn/requested",
      threadId,
      text,
      kind: "message",
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
      writeMode: thread.writeMode,
      viewContext,
    };
  }

  private dispatchTurn(decision: Extract<SendDecision, { kind: "dispatch" }>): SendOutcome {
    const start: TurnDriverStartArgs = {
      threadId: decision.threadId,
      turnId: decision.turnId,
      text: decision.text,
      writeMode: decision.writeMode,
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
    const message = cause instanceof Error ? cause.message : String(cause);
    const buffer = new NotificationBuffer();
    this.db.transaction(
      (tx) => {
        this.appendLocal(tx, [{ type: "provider/error", threadId, message, scope: threadScope() }]);
        buffer.notifyThread(threadId, ["events-appended"]);
        const outcome = applyThreadLifecycleEventInTransaction(tx, {
          threadId,
          // null: this run never produced a turn, and the match against a
          // null activeTurnId means a started run can never be killed by it.
          event: { type: "run.failed", turnId: null },
        });
        if (outcome.applied) {
          buffer.notifyThread(threadId, ["status-changed"]);
        }
      },
      { behavior: "immediate" },
    );
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
   * The one return path for provider events, whatever produced them. Append,
   * lifecycle projection and the queue claim share one transaction; the
   * claimed drain dispatches after commit through the same prepare flow a
   * send uses.
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
    this.db.transaction(
      (tx) => {
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
      },
      { behavior: "immediate" },
    );
    buffer.flushTo(this.notifier);
    for (const claimed of drains) {
      this.dispatchQueuedMessage(threadId, claimed);
    }
  }

  private dispatchQueuedMessage(threadId: string, claimed: ClaimedQueuedThreadMessageRow): void {
    const buffer = new NotificationBuffer();
    const decision = this.db.transaction(
      (tx): SendDecision => {
        const thread = getThread(tx, threadId);
        if (thread === null) {
          return { kind: "done", outcome: { kind: "not-found" } };
        }
        // No view context: the row never held one — see queueInTransaction.
        return this.prepareTurnInTransaction(tx, thread, claimed.text, undefined, buffer);
      },
      { behavior: "immediate" },
    );
    buffer.flushTo(this.notifier);
    if (decision.kind !== "dispatch") {
      // The thread refused new work (e.g. archived between settle and drain):
      // the claim is released, never silently consumed.
      releaseQueuedMessageClaim(this.db, this.notifier, claimed);
      return;
    }
    const outcome = this.dispatchTurn(decision);
    if (outcome.kind === "started") {
      deleteClaimedQueuedThreadMessage(this.db, this.notifier, claimed);
    } else {
      releaseQueuedMessageClaim(this.db, this.notifier, claimed);
    }
  }

  /**
   * Crash recovery, run at construction: this process just booted, so no
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
   */
  private recoverWedgedThreads(): void {
    for (const thread of listThreads(this.db)) {
      if (
        thread.status !== "starting" &&
        thread.status !== "active" &&
        thread.status !== "stopping"
      ) {
        continue;
      }
      if (
        thread.activeTurnId !== null &&
        turnStartOriginDeviceId(this.db, {
          threadId: thread.id,
          turnId: thread.activeTurnId,
        }) !== null
      ) {
        continue;
      }
      const buffer = new NotificationBuffer();
      this.db.transaction(
        (tx) => {
          this.appendLocal(tx, [
            {
              type: "provider/error",
              threadId: thread.id,
              message: "The server restarted while this turn was running",
              scope: threadScope(),
            },
          ]);
          buffer.notifyThread(thread.id, ["events-appended"]);
          const outcome = applyThreadLifecycleEventInTransaction(tx, {
            threadId: thread.id,
            event: { type: "run.failed", turnId: thread.activeTurnId },
          });
          if (outcome.applied) {
            buffer.notifyThread(thread.id, ["status-changed"]);
          }
        },
        { behavior: "immediate" },
      );
      buffer.flushTo(this.notifier);
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
