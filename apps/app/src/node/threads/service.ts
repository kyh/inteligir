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

import type { DbConnection, DbTransaction } from "@repo/db/connection";
import {
  appendEventsInTransaction,
  listStoredThreadEvents,
  type StoredThreadEvent,
} from "@repo/db/events";
import { createTurnId } from "@repo/db/ids";
import { NotificationBuffer, type DbNotifier } from "@repo/db/notifier";
import {
  getPendingInteraction,
  listOpenPendingInteractions,
  resolvePendingInteraction,
  type PendingInteractionRow,
} from "@repo/db/pending-interactions";
import {
  claimNextQueuedThreadMessageInTransaction,
  createQueuedThreadMessageInTransaction,
  deleteClaimedQueuedThreadMessage,
  releaseQueuedMessageClaim,
  type ClaimedQueuedThreadMessageRow,
} from "@repo/db/queued-messages";
import {
  applyThreadLifecycleEventInTransaction,
  archiveThread,
  createThread,
  getThread,
  listThreads,
  type ThreadRow,
} from "@repo/db/threads";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { getThreadEventScopeTurnId, threadScope } from "@repo/domain/thread-event-scope";
import type { ThreadLifecycleEvent } from "@repo/domain/thread-lifecycle";
import type {
  AnswerInteractionRequest,
  CreateThreadRequest,
  PendingInteraction,
  SendMessageRequest,
  Thread,
  TimelineQuery,
  TimelineResponse,
} from "@repo/server-contract/threads";
import { computeTimelineDelta } from "@repo/server-contract/thread-timeline";
import { buildThreadTimeline } from "@repo/thread-view/build-thread-timeline";
import { TurnDriverUnavailableError, type CreateTurnDriver, type TurnDriver } from "./turn-driver";
import type { ProviderEventSink } from "./turn-driver";

export type SendOutcome =
  | { kind: "started"; turnId: string }
  | { kind: "steered"; turnId: string }
  | { kind: "queued"; queuedMessageId: string }
  | { kind: "not-found" }
  | { kind: "conflict"; error: "stale_turn" | "not_steerable" | "archived"; message: string }
  | { kind: "provider-unavailable"; message: string }
  | { kind: "dispatch-failed" };

type SendDecision =
  | { kind: "dispatch"; threadId: string; turnId: string; text: string }
  | { kind: "done"; outcome: SendOutcome };

export type AnswerInteractionOutcome =
  | { kind: "resolved"; interaction: PendingInteraction }
  | { kind: "not-found" }
  | { kind: "already-resolved" };

/** An ingest batch named one thread but carried an event for another. */
export class ThreadEventThreadIdMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`Ingest for thread ${expected} carried an event for thread ${actual}`);
    this.name = "ThreadEventThreadIdMismatchError";
  }
}

export interface ThreadServiceArgs {
  db: DbConnection;
  notifier: DbNotifier;
  createTurnDriver: CreateTurnDriver;
}

function toWireThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    activeTurnId: row.activeTurnId,
    originDocPath: row.originDocPath,
    originAnchor: row.originAnchor,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toWirePendingInteraction(row: PendingInteractionRow): PendingInteraction {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = null;
  }
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

  constructor(args: ThreadServiceArgs) {
    this.db = args.db;
    this.notifier = args.notifier;
    this.driver = args.createTurnDriver(this);
    this.recoverWedgedThreads();
  }

  create(input: CreateThreadRequest): Thread {
    return toWireThread(
      createThread(this.db, this.notifier, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.originDocPath !== undefined ? { originDocPath: input.originDocPath } : {}),
        ...(input.originAnchor !== undefined ? { originAnchor: input.originAnchor } : {}),
      }),
    );
  }

  list(): Thread[] {
    return listThreads(this.db).map(toWireThread);
  }

  get(threadId: string): { thread: Thread; pendingInteractions: PendingInteraction[] } | null {
    const thread = getThread(this.db, threadId);
    if (thread === null) {
      return null;
    }
    return {
      thread: toWireThread(thread),
      pendingInteractions: listOpenPendingInteractions(this.db, threadId).map(
        toWirePendingInteraction,
      ),
    };
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
        return this.prepareTurnInTransaction(tx, thread.id, request.text, buffer);
      case "active": {
        if (request.mode === "queue-if-active") {
          return this.queueInTransaction(tx, thread.id, request.text, buffer);
        }
        if (
          thread.activeTurnId === null ||
          !this.driver.steerTurn({
            threadId: thread.id,
            turnId: thread.activeTurnId,
            text: request.text,
          })
        ) {
          return {
            kind: "done",
            outcome: {
              kind: "conflict",
              error: "not_steerable",
              message: "The active turn cannot be steered",
            },
          };
        }
        appendEventsInTransaction(tx, [
          {
            type: "client/turn/requested",
            threadId: thread.id,
            text: request.text,
            kind: "steer",
            scope: threadScope(),
          },
        ]);
        buffer.notifyThread(thread.id, ["events-appended"]);
        return { kind: "done", outcome: { kind: "steered", turnId: thread.activeTurnId } };
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
   *  the caller's commit. */
  private prepareTurnInTransaction(
    tx: DbTransaction,
    threadId: string,
    text: string,
    buffer: NotificationBuffer,
  ): SendDecision {
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
    appendEventsInTransaction(tx, [
      { type: "client/turn/requested", threadId, text, kind: "message", scope: threadScope() },
    ]);
    buffer.notifyThread(threadId, ["events-appended"]);
    return { kind: "dispatch", threadId, turnId: createTurnId(), text };
  }

  private dispatchTurn(decision: { threadId: string; turnId: string; text: string }): SendOutcome {
    try {
      this.driver.startTurn({
        threadId: decision.threadId,
        turnId: decision.turnId,
        text: decision.text,
      });
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
  private recordDispatchFailure(threadId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const buffer = new NotificationBuffer();
    this.db.transaction(
      (tx) => {
        appendEventsInTransaction(tx, [
          { type: "provider/error", threadId, message, scope: threadScope() },
        ]);
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
    const events = listStoredThreadEvents(this.db, { threadId: query.threadId });
    const full = buildThreadTimeline(events);
    // A delta is served only for a base this log reconstructs exactly; a
    // client ahead of the log (a rebuilt db) gets the full timeline instead.
    if (query.afterSequence === undefined || query.afterSequence > full.maxSequence) {
      return { kind: "full", timeline: full };
    }
    const afterSequence = query.afterSequence;
    const base = buildThreadTimeline(
      events.filter((entry: StoredThreadEvent) => entry.sequence <= afterSequence),
    );
    return { kind: "delta", delta: computeTimelineDelta(base, full) };
  }

  answerInteraction(request: AnswerInteractionRequest): AnswerInteractionOutcome {
    const existing = getPendingInteraction(this.db, request.interactionId);
    if (existing === null || existing.threadId !== request.threadId) {
      return { kind: "not-found" };
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
        appendEventsInTransaction(tx, events);
        buffer.notifyThread(threadId, ["events-appended"]);
        for (const event of events) {
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
          if (outcome.thread.status === "idle") {
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
      (tx) => this.prepareTurnInTransaction(tx, threadId, claimed.text, buffer),
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
      const buffer = new NotificationBuffer();
      this.db.transaction(
        (tx) => {
          appendEventsInTransaction(tx, [
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
    }
  }
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
