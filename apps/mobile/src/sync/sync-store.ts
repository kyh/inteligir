// the cursor and the applied log live in one store: a cursor persisted beside an in-memory log
// claims rows the log never held.

import type { LogPlanStep } from "@repo/api/cloud/sync/plan-page";
import type { ThreadEvent, ThreadEventDelta } from "@repo/domain/provider-event";
import type { SignInSource } from "../notes/notes-store";

// a streamed turn is mostly deltas, and each completed item carries its deltas' final text: a delta
// moves the cursor and the thread's recency and is never held; the live fold draws it meanwhile.
export type StoredThreadEvent = Exclude<ThreadEvent, ThreadEventDelta>;

export interface StoredThread {
  threadId: string;
  events: readonly StoredThreadEvent[];
  lastSeq: number;
}

// the reads are synchronous, for useSyncExternalStore; the writes land on disk before they are read
export interface SyncStore {
  // restored reads back what the last launch held; anything else drops it, on disk too. resolves
  // once that work has landed, and never rejects: a store that cannot read what it held starts
  // over from the log's first row.
  reset: (next: SignInSource | null) => Promise<void>;
  readCursor: () => number;
  // a pulled page is one transaction: its rows and the cursor past them land together or not at all
  applyPlan: (steps: readonly LogPlanStep[]) => Promise<void>;
  snapshotThreads: () => readonly StoredThread[];
  snapshotThread: (threadId: string) => StoredThread | null;
  subscribeThreads: (onChange: () => void) => () => void;
}
