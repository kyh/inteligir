import { threadHasEvents } from "@repo/db/events";
import {
  applyThreadLifecycleEventInTransaction,
  archiveThreadInTransaction,
  getThread,
} from "@repo/db/threads";
import type { ThreadRow } from "@repo/db/threads";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope } from "@repo/domain/thread-event-scope";
import type { Thread, ThreadStop } from "@repo/contract/local/threads/threads-schema";
import type { ThreadWrite } from "./thread-ingest";
import { turnRunsElsewhere } from "./thread-queries";

export type InterruptOutcome =
  | { kind: "answered"; stop: ThreadStop; thread: Thread }
  | { kind: "not-found" }
  | { kind: "remote"; message: string };

// the row, not the wire thread: its origin is resolved after the transaction, off the index.
export type StopOutcome =
  | { kind: "answered"; stop: ThreadStop; thread: ThreadRow }
  | Exclude<InterruptOutcome, { kind: "answered" }>;

type InterruptDecision =
  | { kind: "interrupt"; turnId: string | null }
  | { kind: "done"; outcome: StopOutcome };

// a thread reaches another device with its first request, so a fact about one that never made
// one stays here: sent alone, it would arrive there as an empty action.
const announceInTransaction = (write: ThreadWrite, fact: ThreadEvent): void => {
  if (!threadHasEvents(write.tx, fact.threadId)) {
    return;
  }
  write.appendLocal([fact]);
  write.buffer.notifyThread(fact.threadId, ["events-appended"]);
};

// false for a thread this device does not hold.
export const archiveInTransaction = (write: ThreadWrite, threadId: string): boolean => {
  if (getThread(write.tx, threadId) === null) {
    return false;
  }
  if (archiveThreadInTransaction(write.tx, threadId)) {
    write.buffer.notifyThread(threadId, ["archived-changed"]);
    announceInTransaction(write, { scope: threadScope(), threadId, type: "thread/archived" });
  }
  return true;
};

// a turn another device runs is refused: its provider answers to that process alone.
export const requestStopInTransaction = (
  write: ThreadWrite,
  threadId: string,
): InterruptDecision => {
  const thread = getThread(write.tx, threadId);
  if (thread === null) {
    return { kind: "done", outcome: { kind: "not-found" } };
  }
  switch (thread.status) {
    case "idle":
    case "error": {
      return { kind: "done", outcome: { kind: "answered", stop: "not-running", thread } };
    }
    case "starting":
    case "active":
    case "stopping": {
      if (turnRunsElsewhere(write.tx, thread)) {
        return {
          kind: "done",
          outcome: { kind: "remote", message: "That turn is running on another device" },
        };
      }
      // a second stop finds the thread already stopping, and asks the driver again.
      const requested = applyThreadLifecycleEventInTransaction(write.tx, {
        event: { type: "stop.requested" },
        threadId,
      });
      if (requested.applied) {
        write.buffer.notifyThread(threadId, ["status-changed"]);
      }
      return { kind: "interrupt", turnId: thread.activeTurnId };
    }
    // no default
  }
};
