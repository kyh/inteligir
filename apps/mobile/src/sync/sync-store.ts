// The storage PORT the RN sync client writes through, and nothing else. The
// server's sync client (apps/cli/src/server/cloud) is better-sqlite3 and cannot
// run on React Native, so this is NEW code implementing the SAME @repo/api/cloud
// wire over injected storage — with a fake for the unit suite and a durable
// adapter chosen at composition.
//
// THE PHONE READS THE LOG AND NEVER APPENDS TO IT. The desktop runs the turns,
// so nothing here produces a thread event and there is no outbox; the one thing
// this device writes to the account is a capture, which goes straight over HTTP
// with no queue behind it.
//
// TWO THINGS MUST AGREE, so they live in ONE store rather than two: the pull
// cursor (one global `seq`) and the applied thread log the UI reads. The cursor
// names a position in the account log; the thread log is what those positions
// were applied INTO. A cursor persisted beside an in-memory thread log would
// claim rows the log never saw — the same "two values that can disagree" the
// desktop's credential decision refuses. So `MemorySyncStore` keeps both
// together and `reset()` clears both at once; a durable expo-sqlite adapter
// persists both in one database (the v1 choice is stated in the README).

import type { PlannedLogRow } from "@repo/api/cloud/sync/plan-page";
import type { ThreadEvent } from "@repo/domain/provider-event";

/** A thread as the UI reads it, folded from the events applied to it. */
export interface StoredThread {
  threadId: string;
  events: readonly ThreadEvent[];
  /** The newest account `seq` that contributed to this thread — the sort key
   *  the list orders by. */
  lastSeq: number;
}

/** Append a group of rows to one thread AND advance the cursor together. */
export interface ApplyThreadEventsArgs {
  threadId: string;
  rows: readonly PlannedLogRow[];
  /** The log position this group settles — written with the append, so a replay
   *  cannot land a row twice. */
  cursor: number;
}

export interface SyncStore {
  readCursor(): number;
  writeCursor(seq: number): void;
  applyThreadEvents(args: ApplyThreadEventsArgs): void;
  // Property-function types (not method shorthand) because these three are passed
  // BY REFERENCE to `useSyncExternalStore` — a method reference trips the unbound-
  // method lint, and none of them reads `this`.
  snapshotThreads: () => readonly StoredThread[];
  snapshotThread: (threadId: string) => StoredThread | null;
  /** For `useSyncExternalStore` — fires whenever the applied thread log changes. */
  subscribeThreads: (onChange: () => void) => () => void;

  /** Clear both stores — what unpair and re-pair do, because they describe an
   *  account this device may no longer be talking to. */
  reset(): void;
}
