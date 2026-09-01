// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type {
  ThreadLifecycleEvent,
  ThreadLifecycleNoopReason,
} from "@repo/domain/thread-lifecycle";
import { evaluateThreadLifecycleEvent } from "@repo/domain/thread-lifecycle";
import { and, desc, eq, isNotNull, isNull, like } from "drizzle-orm";
import { writeTransaction, type DbConnection, type DbTransaction } from "./connection";
import { createThreadId } from "./ids";
import type { DbNotifier } from "@repo/domain/notifier";
import { threads } from "./schema";

export type ThreadRow = typeof threads.$inferSelect;

type ThreadWriteConnection = DbConnection | DbTransaction;

export interface CreateThreadInput {
  title?: string;
  originDocPath?: string;
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
      activeTurnId: null,
      originDocPath: input.originDocPath ?? null,
      providerId: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  notifier.notifyThread(row.id, ["thread-created"]);
  return row;
}

export type EnsureThreadOutcome = { row: ThreadRow; created: boolean };

/**
 * The thread an event names, created with THAT id when this database has never
 * seen it — the arrival half of cloud sync.
 *
 * `createThread` is the wrong verb here and its id is the reason: a synced
 * thread's identity belongs to the account, so a device that minted its own
 * would turn one conversation into two, one per device. Everything else about
 * the row is left at its default — an event log carries no title and no
 * origin, so inventing values for them would be this device guessing at
 * facts another device holds.
 */
export function ensureThreadInTransaction(tx: DbTransaction, id: string): EnsureThreadOutcome {
  const existing = tx.select().from(threads).where(eq(threads.id, id)).get();
  if (existing !== undefined) {
    return { row: existing, created: false };
  }
  const now = Date.now();
  const row = tx
    .insert(threads)
    .values({ id, status: "idle", createdAt: now, updatedAt: now })
    .returning()
    .get();
  return { row, created: true };
}

/** Accepts a transaction so read-decide-write flows load the row under the
 *  same lock they act on. */
export function getThread(db: ThreadWriteConnection, id: string): ThreadRow | null {
  return db.select().from(threads).where(eq(threads.id, id)).get() ?? null;
}

/**
 * Every thread, live before archived, newest-updated first within each — as
 * two scans so each is answered by its own partial index (see the schema)
 * instead of a temp b-tree sort.
 */
export function listThreads(db: DbConnection): ThreadRow[] {
  const live = db
    .select()
    .from(threads)
    .where(isNull(threads.archivedAt))
    .orderBy(desc(threads.updatedAt))
    .all();
  const archived = db
    .select()
    .from(threads)
    .where(isNotNull(threads.archivedAt))
    .orderBy(desc(threads.updatedAt))
    .all();
  return [...live, ...archived];
}

/**
 * Follow a moved doc: every thread bound to it (or, for a directory move, to
 * anything under it) keeps pointing at the file it was spawned from.
 *
 * Without this a rename orphans every action attached to the doc —
 * `originDocPath` would still name a path that no longer exists. Runs in the
 * same operation as the link rewrite, for the same reason that one does.
 */
export function rebindThreadOrigins(
  db: DbConnection,
  notifier: DbNotifier,
  args: { from: string; to: string },
): number {
  const moved = db
    .update(threads)
    .set({ originDocPath: args.to, updatedAt: Date.now() })
    .where(eq(threads.originDocPath, args.from))
    .returning({ id: threads.id })
    .all();
  // A directory move carries every doc under it; `/` is appended so a sibling
  // sharing the name's prefix (`Notes2/`) is never caught.
  const prefix = `${args.from}/`;
  const descendants = db
    .select({ id: threads.id, originDocPath: threads.originDocPath })
    .from(threads)
    // No escaping of the prefix's own LIKE wildcards: drizzle's `like` emits no
    // ESCAPE clause, so a backslash would be matched literally and find
    // nothing. The pattern over-matches instead, and `startsWith` below is the
    // authoritative filter.
    .where(like(threads.originDocPath, `${prefix}%`))
    .all();
  for (const row of descendants) {
    if (row.originDocPath === null || !row.originDocPath.startsWith(prefix)) {
      continue;
    }
    db.update(threads)
      .set({
        originDocPath: `${args.to}/${row.originDocPath.slice(prefix.length)}`,
        updatedAt: Date.now(),
      })
      .where(eq(threads.id, row.id))
      .run();
    moved.push({ id: row.id });
  }
  for (const row of moved) {
    notifier.notifyThread(row.id, ["origin-changed"]);
  }
  return moved.length;
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

export interface SetThreadProviderSessionArgs {
  threadId: string;
  providerId: string;
  providerThreadId: string;
}

/**
 * Record the provider session a thread resumes into. No notification: this
 * is runtime plumbing, not a fact any client renders.
 */
export function setThreadProviderSession(
  db: DbConnection,
  args: SetThreadProviderSessionArgs,
): void {
  db.update(threads)
    .set({
      providerId: args.providerId,
      providerThreadId: args.providerThreadId,
      updatedAt: Date.now(),
    })
    .where(eq(threads.id, args.threadId))
    .run();
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
    thread: {
      status: thread.status,
      activeTurnId: thread.activeTurnId,
      archivedAt: thread.archivedAt,
    },
  });
  if ("noop" in evaluation) {
    return {
      applied: false,
      detail: evaluation.detail,
      reason: evaluation.noop,
    };
  }

  // Compare-and-set on the loaded (status, activeTurnId) pair: belt-and-braces
  // under better-sqlite3's synchronous transactions, and the contract that
  // survives any future executor change. The turn id is part of the predicate
  // so a settle validated against turn A can never land after turn B bound.
  const updated = db
    .update(threads)
    .set({ status: evaluation.to, activeTurnId: evaluation.activeTurnId, updatedAt: Date.now() })
    .where(
      and(
        eq(threads.id, args.threadId),
        eq(threads.status, thread.status),
        thread.activeTurnId === null
          ? isNull(threads.activeTurnId)
          : eq(threads.activeTurnId, thread.activeTurnId),
      ),
    )
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
  const outcome = writeTransaction(db, (tx) => applyThreadLifecycleEventRecord(tx, args));
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
