// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type {
  ThreadLifecycleEvent,
  ThreadLifecycleNoopReason,
} from "@repo/domain/thread-lifecycle";
import { evaluateThreadLifecycleEvent } from "@repo/domain/thread-lifecycle";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { DbConnection, DbTransaction } from "./connection";
import { createThreadId } from "./ids";
import type { DbNotifier } from "./notifier";
import { threads } from "./schema";

export type ThreadRow = typeof threads.$inferSelect;

type ThreadWriteConnection = DbConnection | DbTransaction;

export interface CreateThreadInput {
  title?: string;
  originDocPath?: string;
  originAnchor?: string;
}

export function createThread(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateThreadInput,
): ThreadRow {
  const now = Date.now();
  const row = db
    .insert(threads)
    .values({
      id: createThreadId(),
      title: input.title ?? null,
      status: "idle",
      originDocPath: input.originDocPath ?? null,
      originAnchor: input.originAnchor ?? null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  notifier.notifyThread(row.id, ["thread-created"]);
  return row;
}

export function getThread(db: DbConnection, id: string): ThreadRow | null {
  return db.select().from(threads).where(eq(threads.id, id)).get() ?? null;
}

/** Every thread, live before archived, newest-updated first within each. */
export function listThreads(db: DbConnection): ThreadRow[] {
  return db
    .select()
    .from(threads)
    .orderBy(sql`${threads.archivedAt} IS NOT NULL`, desc(threads.updatedAt))
    .all();
}

export function archiveThread(
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
): ThreadRow | null {
  const now = Date.now();
  const updated = db
    .update(threads)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(threads.id, id), isNull(threads.archivedAt)))
    .returning()
    .get();
  if (updated) {
    notifier.notifyThread(id, ["archived-changed"]);
    return updated;
  }
  return getThread(db, id);
}

export type ApplyThreadLifecycleEventNoopReason =
  | ThreadLifecycleNoopReason
  | "not-found"
  | "cas-conflict";

export type ApplyThreadLifecycleEventOutcome =
  | { applied: true; thread: ThreadRow }
  | {
      applied: false;
      detail: string;
      reason: ApplyThreadLifecycleEventNoopReason;
    };

export interface ApplyThreadLifecycleEventArgs {
  event: ThreadLifecycleEvent;
  threadId: string;
}

function applyThreadLifecycleEventRecord(
  db: ThreadWriteConnection,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome {
  const thread = db.select().from(threads).where(eq(threads.id, args.threadId)).get();
  if (!thread) {
    return {
      applied: false,
      detail: `thread not found: ${args.threadId}`,
      reason: "not-found",
    };
  }

  const evaluation = evaluateThreadLifecycleEvent({
    event: args.event,
    // v1 has no thread deletion; the vendored predicate contract keeps the
    // field so deletion arrives as a column, not a domain change.
    thread: { status: thread.status, archivedAt: thread.archivedAt, deletedAt: null },
  });
  if ("noop" in evaluation) {
    return {
      applied: false,
      detail: evaluation.detail,
      reason: evaluation.noop,
    };
  }

  // Compare-and-set on the loaded status: belt-and-braces under
  // better-sqlite3's synchronous transactions, and the contract that survives
  // any future executor change.
  const updated = db
    .update(threads)
    .set({ status: evaluation.to, updatedAt: Date.now() })
    .where(and(eq(threads.id, args.threadId), eq(threads.status, thread.status)))
    .returning()
    .get();
  if (!updated) {
    return {
      applied: false,
      detail: `status changed from ${thread.status} while applying ${args.event.type}`,
      reason: "cas-conflict",
    };
  }
  return { applied: true, thread: updated };
}

/**
 * Single writer for thread lifecycle events: loads the row, evaluates the
 * event against THREAD_LIFECYCLE and its supersession predicates, and applies
 * the transition with a status compare-and-set — all in one transaction.
 * Never throws on stale or illegal events; returns a typed outcome for the
 * caller to log. Use applyThreadLifecycleEventInTransaction from inside an
 * existing transaction (the caller then owns notification).
 */
export function applyThreadLifecycleEvent(
  db: DbConnection,
  notifier: DbNotifier,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome {
  const outcome = db.transaction((tx) => applyThreadLifecycleEventRecord(tx, args), {
    behavior: "immediate",
  });
  if (outcome.applied) {
    notifier.notifyThread(args.threadId, ["status-changed"]);
  }
  return outcome;
}

export function applyThreadLifecycleEventInTransaction(
  tx: DbTransaction,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome {
  return applyThreadLifecycleEventRecord(tx, args);
}
