// an ingest reads, validates, appends, projects lifecycle and touches the queue inside ONE
// transaction: a crash between two of those writes would leave the log saying one thing and the
// thread row or its queue another.

import type { DbTransaction } from "@repo/db/connection";
import { storedTurnFailure } from "@repo/db/events";
import { claimNextQueuedThreadMessageInTransaction } from "@repo/db/queued-messages";
import type { ClaimedQueuedThreadMessageRow } from "@repo/db/queued-messages";
import {
  applyThreadLifecycleEventInTransaction,
  nameUntitledThreadInTransaction,
} from "@repo/db/threads";
import type { NotificationBuffer } from "@repo/domain/notifier";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope } from "@repo/domain/thread-event-scope";
import type { ThreadLifecycleEvent } from "@repo/domain/thread-lifecycle";
import { isThreadRunning } from "@repo/domain/thread-status";
import { deriveThreadTitle } from "@repo/domain/thread-title";
import { QUEUE_HOLDING_FAILURES } from "./provider-failure";

export class ThreadEventThreadIdMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`Ingest for thread ${expected} carried an event for thread ${actual}`);
    this.name = "ThreadEventThreadIdMismatchError";
  }
}

// one write transaction as every thread step sees it. its notifications wait for the commit, and
// every append goes through `append`, the one path a thread's log grows by.
export interface ThreadWrite {
  tx: DbTransaction;
  buffer: NotificationBuffer;
  append: (events: readonly ThreadEvent[]) => void;
}

const lifecycleEventFor = (event: ThreadEvent): ThreadLifecycleEvent | null => {
  switch (event.type) {
    case "turn/started": {
      return { turnId: event.scope.turnId, type: "run.started" };
    }
    case "turn/completed": {
      const { turnId } = event.scope;
      // an interrupted turn still settled: only a failed one reads as an error.
      return event.status === "failed"
        ? { turnId, type: "run.failed" }
        : { turnId, type: "run.succeeded" };
    }
    case "client/turn/requested":
    case "item/agentMessage/delta":
    case "item/completed":
    case "item/reasoning/textDelta":
    case "item/started":
    case "provider/error": {
      return null;
    }
    // no default
  }
};

// the first message a thread carries names it, whichever client sent it.
export const nameThreadFromRequestsInTransaction = (
  write: ThreadWrite,
  threadId: string,
  events: readonly ThreadEvent[],
): void => {
  for (const event of events) {
    if (event.type !== "client/turn/requested") {
      continue;
    }
    const title = deriveThreadTitle(event.text);
    if (title === null) {
      continue;
    }
    if (nameUntitledThreadInTransaction(write.tx, { threadId, title })) {
      write.buffer.notifyThread(threadId, ["title-changed"]);
    }
    return;
  }
};

const failureHoldsQueue = (
  tx: DbTransaction,
  threadId: string,
  event: ThreadLifecycleEvent,
): boolean => {
  if (event.type !== "run.failed" || event.turnId === null) {
    return false;
  }
  const failure = storedTurnFailure(tx, { threadId, turnId: event.turnId });
  return failure !== null && QUEUE_HOLDING_FAILURES.has(failure);
};

// a queued reply follows the turn it waited on however that turn ended, a stop and an ordinary
// failure included, but not a usage-limit or signed-out refusal (above): it is claimed here, in
// the settle's transaction, and dispatched after commit.
export const projectLifecycleInTransaction = (
  write: ThreadWrite,
  args: { threadId: string; event: ThreadLifecycleEvent; drain: boolean },
): ClaimedQueuedThreadMessageRow | null => {
  const { threadId, event } = args;
  const outcome = applyThreadLifecycleEventInTransaction(write.tx, { event, threadId });
  if (!outcome.applied) {
    // a late completion for a superseded turn is expected traffic.
    console.warn(
      `thread ${threadId}: ${event.type} not applied (${outcome.reason}): ${outcome.detail}`,
    );
    return null;
  }
  write.buffer.notifyThread(threadId, ["status-changed"]);
  if (
    isThreadRunning(outcome.thread.status) ||
    !args.drain ||
    failureHoldsQueue(write.tx, threadId, event)
  ) {
    return null;
  }
  const claimed = claimNextQueuedThreadMessageInTransaction(write.tx, threadId);
  if (claimed !== null) {
    write.buffer.notifyThread(threadId, ["queue-changed"]);
  }
  return claimed;
};

export interface IngestArgs {
  origin: "local" | "recovery";
  threadId: string;
  events: readonly ThreadEvent[];
}

export const ingestEvents = (args: IngestArgs): readonly ThreadEvent[] => {
  const mismatched = args.events.find((event) => event.threadId !== args.threadId);
  if (mismatched !== undefined) {
    throw new ThreadEventThreadIdMismatchError(args.threadId, mismatched.threadId);
  }
  return args.events;
};

// what the commit leaves to do: start what the settles claimed from the queue.
export const ingestInTransaction = (
  write: ThreadWrite,
  args: IngestArgs,
): ClaimedQueuedThreadMessageRow[] => {
  const { events, threadId } = args;
  write.append(events);
  write.buffer.notifyThread(threadId, ["events-appended"]);
  nameThreadFromRequestsInTransaction(write, threadId, events);
  const drains: ClaimedQueuedThreadMessageRow[] = [];
  for (const event of events) {
    const lifecycleEvent = lifecycleEventFor(event);
    if (lifecycleEvent === null) {
      continue;
    }
    // a recovery settle does not drain: a restart never starts a turn on its own, and the
    // next send takes the head.
    const claimed = projectLifecycleInTransaction(write, {
      drain: args.origin === "local",
      event: lifecycleEvent,
      threadId,
    });
    if (claimed !== null) {
      drains.push(claimed);
    }
  }
  return drains;
};

// not routed through ingest: a thread-scoped provider/error projects no
// lifecycle, so the thread would stay wedged in starting. the null turnId
// match is what stops it killing a run that did start.
export const failTurnlessRunInTransaction = (
  write: ThreadWrite,
  threadId: string,
  message: string,
): void => {
  write.append([{ message, scope: threadScope(), threadId, type: "provider/error" }]);
  write.buffer.notifyThread(threadId, ["events-appended"]);
  const outcome = applyThreadLifecycleEventInTransaction(write.tx, {
    event: { turnId: null, type: "run.failed" },
    threadId,
  });
  if (outcome.applied) {
    write.buffer.notifyThread(threadId, ["status-changed"]);
  }
};
