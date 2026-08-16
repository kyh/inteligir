// The threads core: one service owning the send modes, the provider event
// ingest (the ONLY writer of provider events), and the queue drain — so the
// HTTP handlers, the fake driver and the future codex adapter (#549) all
// converge on a single append path with server-assigned sequences.

import type { DbConnection } from "@repo/db/connection";
import {
  appendEvents,
  getOpenTurnId,
  listStoredThreadEvents,
  type StoredThreadEvent,
} from "@repo/db/events";
import { createTurnId } from "@repo/db/ids";
import type { DbNotifier } from "@repo/db/notifier";
import {
  getPendingInteraction,
  listOpenPendingInteractions,
  resolvePendingInteraction,
  type PendingInteractionRow,
} from "@repo/db/pending-interactions";
import {
  claimNextQueuedThreadMessage,
  createQueuedThreadMessage,
  deleteClaimedQueuedThreadMessage,
} from "@repo/db/queued-messages";
import {
  applyThreadLifecycleEvent,
  archiveThread,
  createThread,
  getThread,
  listThreads,
  type ThreadRow,
} from "@repo/db/threads";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope } from "@repo/domain/thread-event-scope";
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
import { computeTimelineRowDelta } from "@repo/server-contract/thread-timeline";
import { buildThreadTimeline } from "@repo/thread-view/build-thread-timeline";
import {
  TurnDriverUnavailableError,
  type CreateTurnDriver,
  type ProviderEventSink,
  type TurnDriver,
} from "./turn-driver";

export type SendOutcome =
  | { kind: "started"; turnId: string }
  | { kind: "steered"; turnId: string }
  | { kind: "queued"; queuedMessageId: string }
  | { kind: "not-found" }
  | { kind: "conflict"; error: "stale_turn" | "not_steerable" | "archived"; message: string }
  | { kind: "provider-unavailable" };

export type AnswerInteractionOutcome =
  | { kind: "resolved"; interaction: PendingInteraction }
  | { kind: "not-found" }
  | { kind: "already-resolved" };

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
    const thread = getThread(this.db, request.threadId);
    if (thread === null) {
      return { kind: "not-found" };
    }
    if (thread.archivedAt !== null) {
      return {
        kind: "conflict",
        error: "archived",
        message: "The thread is archived",
      };
    }

    const openTurnId = getOpenTurnId(this.db, thread.id);
    if (request.expectedTurnId !== undefined && request.expectedTurnId !== openTurnId) {
      return {
        kind: "conflict",
        error: "stale_turn",
        message: "The turn this message addressed is no longer the open one",
      };
    }

    switch (thread.status) {
      case "idle":
      case "error":
        return this.startNewTurn(thread.id, request.text);
      case "active": {
        if (request.mode === "queue-if-active") {
          return this.queueMessage(thread.id, request.text);
        }
        if (
          openTurnId === null ||
          !this.driver.steerTurn({ threadId: thread.id, turnId: openTurnId, text: request.text })
        ) {
          return {
            kind: "conflict",
            error: "not_steerable",
            message: "The active turn cannot be steered",
          };
        }
        appendEvents(this.db, this.notifier, [
          {
            type: "client/turn/requested",
            threadId: thread.id,
            text: request.text,
            kind: "steer",
            scope: threadScope(),
          },
        ]);
        return { kind: "steered", turnId: openTurnId };
      }
      case "starting":
      case "stopping": {
        if (request.mode === "queue-if-active") {
          return this.queueMessage(thread.id, request.text);
        }
        return {
          kind: "conflict",
          error: "not_steerable",
          message: `A ${thread.status} thread has no steerable turn`,
        };
      }
    }
  }

  timeline(query: TimelineQuery): TimelineResponse | null {
    if (getThread(this.db, query.threadId) === null) {
      return null;
    }
    const events = listStoredThreadEvents(this.db, { threadId: query.threadId });
    const full = buildThreadTimeline(events);
    if (query.afterSequence === undefined) {
      return { kind: "full", timeline: full };
    }
    // The client's afterSequence names the log prefix it projected last time;
    // reprojecting that prefix reproduces its rows exactly (the projection is
    // pure), so the diff is correct without the server storing any client
    // state.
    const afterSequence = query.afterSequence;
    const prevRows = buildThreadTimeline(
      events.filter((entry: StoredThreadEvent) => entry.sequence <= afterSequence),
    ).rows;
    return {
      kind: "delta",
      delta: computeTimelineRowDelta(prevRows, full.rows),
      maxSequence: full.maxSequence,
    };
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
      case "resolved":
        return { kind: "resolved", interaction: toWirePendingInteraction(outcome.interaction) };
      case "already-resolved":
        return { kind: "already-resolved" };
      case "not-found":
        return { kind: "not-found" };
    }
  }

  /**
   * The one return path for provider events, whatever produced them: append
   * through the transactional sequence allocator, then fold the lifecycle
   * signals into the thread's status. A turn settling to idle drains the
   * queue before this call returns.
   */
  ingestProviderEvents(threadId: string, events: readonly ThreadEvent[]): void {
    appendEvents(this.db, this.notifier, events);
    for (const event of events) {
      const lifecycleEvent = lifecycleEventFor(event);
      if (lifecycleEvent === null) {
        continue;
      }
      const outcome = applyThreadLifecycleEvent(this.db, this.notifier, {
        threadId,
        event: lifecycleEvent,
      });
      if (outcome.applied && outcome.thread.status === "idle") {
        this.drainQueue(threadId);
      }
    }
  }

  private startNewTurn(threadId: string, text: string): SendOutcome {
    const preparing = applyThreadLifecycleEvent(this.db, this.notifier, {
      threadId,
      event: { type: "run.preparing" },
    });
    if (!preparing.applied) {
      return {
        kind: "conflict",
        error: "not_steerable",
        message: `Cannot start a turn: ${preparing.detail}`,
      };
    }
    appendEvents(this.db, this.notifier, [
      {
        type: "client/turn/requested",
        threadId,
        text,
        kind: "message",
        scope: threadScope(),
      },
    ]);
    const turnId = createTurnId();
    try {
      this.driver.startTurn({ threadId, turnId, text });
    } catch (error) {
      if (error instanceof TurnDriverUnavailableError) {
        applyThreadLifecycleEvent(this.db, this.notifier, {
          threadId,
          event: { type: "run.failed" },
        });
        return { kind: "provider-unavailable" };
      }
      throw error;
    }
    return { kind: "started", turnId };
  }

  private queueMessage(threadId: string, text: string): SendOutcome {
    const queued = createQueuedThreadMessage(this.db, this.notifier, { threadId, text });
    return { kind: "queued", queuedMessageId: queued.id };
  }

  private drainQueue(threadId: string): void {
    const claimed = claimNextQueuedThreadMessage(this.db, this.notifier, threadId);
    if (claimed === null) {
      return;
    }
    // Consumed either way: on a failed dispatch the message is already in the
    // log as the request the failure answered, so releasing the claim would
    // only duplicate the user's words on the next drain.
    deleteClaimedQueuedThreadMessage(this.db, this.notifier, claimed);
    this.startNewTurn(threadId, claimed.text);
  }
}

function lifecycleEventFor(event: ThreadEvent): ThreadLifecycleEvent | null {
  switch (event.type) {
    case "turn/started":
      return { type: "run.started" };
    case "turn/completed":
      // An interrupted turn still SETTLED — run.succeeded lands it idle from
      // active/starting/stopping alike; only a failed turn reads as an error.
      return event.status === "failed" ? { type: "run.failed" } : { type: "run.succeeded" };
    default:
      return null;
  }
}
