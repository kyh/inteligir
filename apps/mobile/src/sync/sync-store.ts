// the cursor and the applied log live in one store: a cursor persisted beside an in-memory log
// claims rows the log never held.

import type { PlannedLogRow } from "@repo/api/cloud/sync/plan-page";
import type { ThreadEvent } from "@repo/domain/provider-event";

export interface StoredThread {
  threadId: string;
  events: readonly ThreadEvent[];
  lastSeq: number;
}

export interface ApplyThreadEventsArgs {
  threadId: string;
  rows: readonly PlannedLogRow[];
  cursor: number;
}

export interface SyncStore {
  readCursor(): number;
  writeCursor(seq: number): void;
  applyThreadEvents(args: ApplyThreadEventsArgs): void;
  // property-function types, not method shorthand: these are passed by reference to
  // useSyncExternalStore, and a method reference trips the unbound-method lint.
  snapshotThreads: () => readonly StoredThread[];
  snapshotThread: (threadId: string) => StoredThread | null;
  subscribeThreads: (onChange: () => void) => () => void;

  reset(): void;
}
