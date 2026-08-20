// The storage PORT the RN sync client writes through, and nothing else. The
// desktop client (apps/app/src/node/cloud) is better-sqlite3 and cannot run on
// React Native, so this is NEW code implementing the SAME @repo/cloud-contract
// wire over injected storage — with a fake for the unit suite and a durable
// adapter chosen at composition.
//
// FOUR THINGS MUST AGREE, so they live in ONE store rather than four:
//   • the outbox (frozen bytes + a per-device counter),
//   • the pull cursor (one global `seq`),
//   • the applied thread log the UI reads,
//   • the applied-capture ledger.
// The cursor names a position in the account log; the thread log is what those
// positions were applied INTO. A cursor persisted beside an in-memory thread log
// would claim rows the log never saw — the same "two values that can disagree"
// the desktop's credential decision refuses. So `MemorySyncStore` keeps all four
// together and `reset()` clears all four at once; a durable expo-sqlite adapter
// persists all four in one database (the v1 choice is stated in the README).

import type { ThreadEvent } from "@repo/domain/provider-event";

/** A queued outbound event, its bytes FROZEN at enqueue. The device counter is
 *  assigned by the store, never recomputed — a counter over a shrinking queue
 *  hands a later event a position the log already holds. */
export interface OutboxRow {
  deviceSeq: number;
  threadId: string;
  /** `JSON.stringify(event)`, serialized once. Re-serializing at push time is
   *  what turns a retry after a grammar change into a `sync-conflict`. */
  body: string;
  createdAt: number;
}

/** What the store is asked to enqueue — the frozen body, before a position is
 *  assigned. */
export interface OutboxDraft {
  threadId: string;
  body: string;
  createdAt: number;
}

/**
 * One pulled event WITH the account log's own identity. `origin` is what makes a
 * re-pull idempotent — a row already applied under `(deviceId, deviceSeq)` is
 * skipped — and `seq` is the account-global position the cursor advances to.
 */
export interface AppliedRow {
  event: ThreadEvent;
  origin: { deviceId: string; deviceSeq: number };
  seq: number;
}

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
  rows: readonly AppliedRow[];
  /** The log position this group settles — written with the append, so a replay
   *  cannot land a row twice. */
  cursor: number;
}

export interface SyncStore {
  // -- outbox (push) --------------------------------------------------------
  /** Freeze these rows into the queue, assigning each the next device position. */
  enqueueOutbox(drafts: readonly OutboxDraft[]): void;
  /** The next batch's rows, oldest first, at most `limit`. */
  listOutbox(limit: number): readonly OutboxRow[];
  /** Drop every row at or below `deviceSeq`; returns how many. Never rewinds the
   *  counter — see `OutboxRow`. */
  deleteOutboxThrough(deviceSeq: number): number;
  countOutbox(): number;

  // -- cursor + applied thread log (pull) -----------------------------------
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

  // -- applied-capture ledger -----------------------------------------------
  /** The subset of `ids` this device has NOT applied before — the idempotency
   *  gate for at-least-once capture delivery. */
  filterUnappliedCaptures(ids: readonly string[]): ReadonlySet<string>;
  recordAppliedCaptures(ids: readonly string[], appliedAt: number): void;
  pruneAppliedCaptures(before: number): void;

  // -- lifecycle ------------------------------------------------------------
  /** Clear all four stores — what unpair and re-pair do, because they describe
   *  an account this device may no longer be talking to. */
  reset(): void;
}
