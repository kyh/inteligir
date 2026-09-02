// ingest and send each read, validate, append, project lifecycle and touch the
// queue inside one transaction; notifications flush after commit. driver
// dispatch is the one step after commit: a scripted driver re-enters ingest
// synchronously and a transaction cannot nest, so a dispatch failure is folded
// back in its own.

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

// threads-router switches exhaustively over this, so a new member breaks there rather than becoming a 500.
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

export class ThreadEventThreadIdMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`Ingest for thread ${expected} carried an event for thread ${actual}`);
    this.name = "ThreadEventThreadIdMismatchError";
  }
}

// inside the transaction that writes the events: an event is owed to the account's log exactly when it is in the local one.
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

// null for unparseable bytes: deny is always answerable, so it costs one card's detail rather than the thread.
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

  // a method rather than constructor work because it writes.
  boot(): void {
    // before the sweep: a claim held by the dead process hides its message from
    // both the queue read and the next drain. a swept row does not auto-dispatch.
    releaseAllQueuedMessageClaims(this.db);
    this.recoverWedgedThreads();
  }

  // every local append goes through here so the outbox enqueue rides the same
  // transaction; a site that skipped it would drop events out of sync with no symptom.
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

  // a queued message carries no view context: it drains minutes later, long
  // after the screen it described; storing one gives away the immediacy that keeps it honest.
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

  // takes the loaded row: the dispatch must carry what this transaction read, not what a second query could observe.
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
      // the drain's case: an archive landed between the settle and the claim.
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

  private recordDispatchFailure(threadId: string, cause: unknown): void {
    this.failTurnlessRun(threadId, cause instanceof Error ? cause.message : String(cause));
  }

  // not routed through ingest: a thread-scoped provider/error projects no
  // lifecycle, so the thread would stay wedged in starting. the null turnId
  // match is what stops it killing a run that did start.
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
    // a client ahead of the log (a rebuilt db) gets the full timeline.
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
        // after the row is resolved: a crash between the two leaves a resolved
        // row and a provider request the turn-end timeout settles.
        this.driver.onInteractionResolved?.(interaction);
        return { kind: "resolved", interaction };
      }
      case "already-resolved":
        return { kind: "already-resolved" };
      case "not-found":
        return { kind: "not-found" };
    }
  }

  ingestProviderEvents(threadId: string, events: readonly ThreadEvent[]): void {
    this.ingest({ origin: "local", threadId, events });
  }

  // the same ingest, marked remote: the thread row is created with the log's
  // id, nothing is enqueued back to the outbox (two devices would echo forever),
  // and a settle does not drain this device's queue — the turn ran elsewhere.
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
      // lifecycle projects over the rows that landed, so a re-pair's full replay is a no-op rather than a status flap.
      let projected: readonly ThreadEvent[] = events;
      if (args.origin === "remote") {
        if (ensureThreadInTransaction(tx, threadId).created) {
          buffer.notifyThread(threadId, ["thread-created"]);
        }
        const landed = appendSyncedEventsInTransaction(tx, args.rows);
        projected = landed.applied.map((row) => row.event);
        // the cursor moves in this transaction: as a second write it leaves a
        // window a crash replays into duplicate rows. it advances even when
        // nothing landed — seen, not new.
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
          // a late completion for a superseded turn is expected traffic.
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

  // the queue row and its request event are one transaction: deleting after
  // the dispatch left a window where a refused start released the row and the
  // next drain appended the message a second time, on every paired device.
  private dispatchQueuedMessage(threadId: string, claimed: ClaimedQueuedThreadMessageRow): void {
    const buffer = new NotificationBuffer();
    const decision = writeTransaction(this.db, (tx): SendDecision => {
      const thread = getThread(tx, threadId);
      if (thread === null) {
        return { kind: "done", outcome: { kind: "not-found" } };
      }
      const prepared = this.prepareTurnInTransaction(tx, thread, claimed.text, undefined, buffer);
      if (prepared.kind === "dispatch") {
        deleteClaimedQueuedThreadMessageInTransaction(tx, claimed);
        buffer.notifyThread(threadId, ["queue-changed"]);
      }
      return prepared;
    });
    buffer.flushTo(this.notifier);
    if (decision.kind !== "dispatch") {
      // prepare appended nothing (archived between settle and drain): release, never consume.
      releaseQueuedMessageClaim(this.db, this.notifier, claimed);
      return;
    }
    this.dispatchTurn(decision);
  }

  // only the process that owns a provider may declare it dead: a synced thread
  // can be active because another device's turn is running, so the turn/started
  // row is asked who wrote it. a recovered turn gets turn/completed too —
  // provider/error alone projects no lifecycle, and the turn row would render
  // "working" forever.
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
        // a crash between run.preparing and run.started: no turn to complete, so the failure names none.
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
      // the provider requests behind these rows died with the old process; a restarted provider raises fresh rows.
      interruptOpenPendingInteractions(this.db, this.notifier, thread.id);
    }
  }
}

// the same parse the runtime's answer path runs, so a resolution this passes is never silently denied downstream.
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
      // the scope policy makes a turn-less turn/started unparseable; the null branch guards a policy change.
      return turnId === null ? null : { type: "run.started", turnId };
    case "turn/completed":
      // an interrupted turn still settled: only a failed one reads as an error.
      return event.status === "failed"
        ? { type: "run.failed", turnId }
        : { type: "run.succeeded", turnId };
    default:
      return null;
  }
}
