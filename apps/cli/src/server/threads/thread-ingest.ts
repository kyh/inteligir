// an ingest reads, validates, appends, projects lifecycle and touches the queue inside ONE
// transaction, whichever device the events came from: a crash between two of those writes would
// leave the log saying one thing and the thread row or its queue another.

import type { DbTransaction } from "@repo/db/connection";
import {
  appendSyncedEventsInTransaction,
  listThreadMetaEvents,
  storedTurnFailure,
} from "@repo/db/events";
import type { SyncedEventInput } from "@repo/db/events";
import { claimNextQueuedThreadMessageInTransaction } from "@repo/db/queued-messages";
import type { ClaimedQueuedThreadMessageRow } from "@repo/db/queued-messages";
import { writeSyncCursor } from "@repo/db/sync-outbox";
import {
  applyThreadLifecycleEventInTransaction,
  applyThreadMetaInTransaction,
  archiveThreadInTransaction,
  ensureThreadInTransaction,
  getThread,
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
// every local append goes through `appendLocal` so the outbox enqueue rides the same transaction;
// a site that skipped it would drop events out of sync with no symptom.
export interface ThreadWrite {
  tx: DbTransaction;
  buffer: NotificationBuffer;
  appendLocal: (events: readonly ThreadEvent[]) => void;
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
    case "provider/error":
    case "thread/archived":
    case "thread/meta": {
      return null;
    }
    // no default
  }
};

// the first message a thread carries names it, whichever client sent it and on whichever device.
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

// the thread's own facts, whichever device stated them; answers whether a row archived it here.
const projectThreadFactsInTransaction = (
  write: ThreadWrite,
  threadId: string,
  events: readonly ThreadEvent[],
): boolean => {
  let archived = false;
  for (const event of events) {
    if (event.type === "thread/meta") {
      const change = applyThreadMetaInTransaction(write.tx, { facts: event, threadId });
      if (change.title) {
        write.buffer.notifyThread(threadId, ["title-changed"]);
      }
      if (change.origin) {
        write.buffer.notifyThread(threadId, ["origin-changed"]);
      }
    } else if (event.type === "thread/archived" && archiveThreadInTransaction(write.tx, threadId)) {
      write.buffer.notifyThread(threadId, ["archived-changed"]);
      archived = true;
    }
  }
  return archived;
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

// a provider started a turn here, so the harness the row names is bound: the log states it once,
// and another device keeps it. the session id is this device's alone and never travels.
const stateHarnessInTransaction = (write: ThreadWrite, threadId: string): void => {
  const providerId = getThread(write.tx, threadId)?.providerId ?? null;
  if (
    providerId === null ||
    listThreadMetaEvents(write.tx, threadId).some((meta) => meta.providerId !== undefined)
  ) {
    return;
  }
  write.appendLocal([{ providerId, scope: threadScope(), threadId, type: "thread/meta" }]);
};

export type IngestArgs =
  | { origin: "local" | "recovery"; threadId: string; events: readonly ThreadEvent[] }
  | { origin: "remote"; threadId: string; rows: readonly SyncedEventInput[]; cursor: number };

// what the commit leaves to do: stop a thread another device archived, and start what the settles
// claimed from the queue.
export interface IngestResult {
  archived: boolean;
  drains: ClaimedQueuedThreadMessageRow[];
}

export const ingestEvents = (args: IngestArgs): readonly ThreadEvent[] => {
  const events = args.origin === "remote" ? args.rows.map((row) => row.event) : args.events;
  const mismatched = events.find((event) => event.threadId !== args.threadId);
  if (mismatched !== undefined) {
    throw new ThreadEventThreadIdMismatchError(args.threadId, mismatched.threadId);
  }
  return events;
};

export const ingestInTransaction = (write: ThreadWrite, args: IngestArgs): IngestResult => {
  const { threadId } = args;
  // lifecycle projects over the rows that landed, so a full replay after signing in again is a no-op rather than a status flap.
  let projected: readonly ThreadEvent[];
  if (args.origin === "remote") {
    if (ensureThreadInTransaction(write.tx, threadId).created) {
      write.buffer.notifyThread(threadId, ["thread-created"]);
    }
    const landed = appendSyncedEventsInTransaction(write.tx, args.rows);
    projected = landed.applied.map((row) => row.event);
    // the cursor moves in this transaction: as a second write it leaves a
    // window a crash replays into duplicate rows. it advances even when
    // nothing landed — seen, not new.
    writeSyncCursor(write.tx, args.cursor);
    if (projected.length === 0) {
      return { archived: false, drains: [] };
    }
  } else {
    projected = args.events;
    write.appendLocal(projected);
  }
  write.buffer.notifyThread(threadId, ["events-appended"]);
  // before the naming: a stated title outranks the one a first line would give.
  const archived = projectThreadFactsInTransaction(write, threadId, projected);
  nameThreadFromRequestsInTransaction(write, threadId, projected);
  const drains: ClaimedQueuedThreadMessageRow[] = [];
  for (const event of projected) {
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
  if (args.origin === "local" && projected.some((event) => event.type === "turn/started")) {
    stateHarnessInTransaction(write, threadId);
  }
  return { archived, drains };
};

// not routed through ingest: a thread-scoped provider/error projects no
// lifecycle, so the thread would stay wedged in starting. the null turnId
// match is what stops it killing a run that did start.
export const failTurnlessRunInTransaction = (
  write: ThreadWrite,
  threadId: string,
  message: string,
): void => {
  write.appendLocal([{ message, scope: threadScope(), threadId, type: "provider/error" }]);
  write.buffer.notifyThread(threadId, ["events-appended"]);
  const outcome = applyThreadLifecycleEventInTransaction(write.tx, {
    event: { turnId: null, type: "run.failed" },
    threadId,
  });
  if (outcome.applied) {
    write.buffer.notifyThread(threadId, ["status-changed"]);
  }
};
