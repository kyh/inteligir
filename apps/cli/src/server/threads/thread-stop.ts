import {
  applyThreadLifecycleEventInTransaction,
  archiveThreadInTransaction,
  getThread,
} from "@repo/db/threads";
import type { ThreadRow } from "@repo/db/threads";
import type { Thread, ThreadStop } from "@repo/contract/local/threads/threads-schema";
import type { ThreadWrite } from "./thread-ingest";

export type InterruptOutcome =
  | { kind: "answered"; stop: ThreadStop; thread: Thread }
  | { kind: "not-found" };

// the row, not the wire thread: its origin is resolved after the transaction, off the index.
export type StopOutcome =
  | { kind: "answered"; stop: ThreadStop; thread: ThreadRow }
  | Exclude<InterruptOutcome, { kind: "answered" }>;

type InterruptDecision =
  | { kind: "interrupt"; turnId: string | null }
  | { kind: "done"; outcome: StopOutcome };

// false for an unknown thread.
export const archiveInTransaction = (write: ThreadWrite, threadId: string): boolean => {
  if (getThread(write.tx, threadId) === null) {
    return false;
  }
  if (archiveThreadInTransaction(write.tx, threadId)) {
    write.buffer.notifyThread(threadId, ["archived-changed"]);
  }
  return true;
};

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
