// the cursor and the applied log live in one store: a cursor persisted beside an in-memory log
// claims rows the log never held.

import type { PlannedLogRow } from "@repo/api/cloud/sync/plan-page";
import type { ThreadEvent, ThreadEventDelta } from "@repo/domain/provider-event";

// a streamed turn is mostly deltas and the phone renders completed items only, which carry the
// deltas' final text: a delta moves the cursor and the thread's recency, and is never held.
export type StoredThreadEvent = Exclude<ThreadEvent, ThreadEventDelta>;

export interface StoredThread {
  threadId: string;
  events: readonly StoredThreadEvent[];
  lastSeq: number;
}

export interface ApplyThreadEventsArgs {
  threadId: string;
  rows: readonly PlannedLogRow[];
  cursor: number;
}

export interface SyncStore {
  readCursor: () => number;
  writeCursor: (seq: number) => void;
  applyThreadEvents: (args: ApplyThreadEventsArgs) => void;
  snapshotThreads: () => readonly StoredThread[];
  snapshotThread: (threadId: string) => StoredThread | null;
  subscribeThreads: (onChange: () => void) => () => void;
  reset: () => void;
}
