// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type {
  ThreadLifecycleEvent,
  ThreadLifecycleNoopReason,
} from "@repo/domain/thread-lifecycle";
import { evaluateThreadLifecycleEvent } from "@repo/domain/thread-lifecycle";
import { and, desc, eq, isNotNull, isNull, like } from "drizzle-orm";
import { writeTransaction } from "./connection";
import type { DbConnection, DbTransaction } from "./connection";
import { createThreadId } from "./ids";
import type { DbNotifier } from "@repo/domain/notifier";
import { threads } from "./schema";

export type ThreadRow = typeof threads.$inferSelect;

type ThreadWriteConnection = DbConnection | DbTransaction;

export interface CreateThreadInput {
  title?: string;
  originDocPath?: string;
}

export const createThread = (
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateThreadInput,
): ThreadRow => {
  const now = Date.now();
  const row = db
    .insert(threads)
    .values({
      activeTurnId: null,
      archivedAt: null,
      createdAt: now,
      id: createThreadId(),
      originDocPath: input.originDocPath ?? null,
      providerId: null,
      status: "idle",
      title: input.title ?? null,
      updatedAt: now,
    })
    .returning()
    .get();
  notifier.notifyThread(row.id, ["thread-created"]);
  return row;
};

export interface EnsureThreadOutcome {
  row: ThreadRow;
  created: boolean;
}

// created with the log's id, not `createThread`'s: a device minting its own turns one synced
// conversation into two. title and origin stay default because the event log carries neither.
export const ensureThreadInTransaction = (tx: DbTransaction, id: string): EnsureThreadOutcome => {
  const existing = tx.select().from(threads).where(eq(threads.id, id)).get();
  if (existing !== undefined) {
    return { created: false, row: existing };
  }
  const now = Date.now();
  const row = tx
    .insert(threads)
    .values({ createdAt: now, id, status: "idle", updatedAt: now })
    .returning()
    .get();
  return { created: true, row };
};

export const getThread = (db: ThreadWriteConnection, id: string): ThreadRow | null =>
  db.select().from(threads).where(eq(threads.id, id)).get() ?? null;

// two scans so each is answered by its own partial index instead of a temp b-tree sort.
export const listThreads = (db: DbConnection): ThreadRow[] => {
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
};

export const rebindThreadOrigins = (
  db: DbConnection,
  notifier: DbNotifier,
  args: { from: string; to: string },
): number => {
  const moved = db
    .update(threads)
    .set({ originDocPath: args.to, updatedAt: Date.now() })
    .where(eq(threads.originDocPath, args.from))
    .returning({ id: threads.id })
    .all();
  // "/" appended so a sibling sharing the name's prefix (`Notes2/`) is never caught.
  const prefix = `${args.from}/`;
  const descendants = db
    .select({ id: threads.id, originDocPath: threads.originDocPath })
    .from(threads)
    // drizzle's `like` emits no ESCAPE clause, so escaping the prefix's own wildcards would match
    // a literal backslash and find nothing; the pattern over-matches and `startsWith` filters.
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
};

export const archiveThread = (
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
): ThreadRow | null => {
  const now = Date.now();
  const updated = db
    .update(threads)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(threads.id, id), isNull(threads.archivedAt)))
    .returning()
    .get();
  if (updated !== undefined) {
    notifier.notifyThread(id, ["archived-changed"]);
    return updated;
  }
  return getThread(db, id);
};

export interface SetThreadProviderSessionArgs {
  threadId: string;
  providerId: string;
  providerThreadId: string;
}

// no notification: runtime plumbing, not a fact a client renders.
export const setThreadProviderSession = (
  db: DbConnection,
  args: SetThreadProviderSessionArgs,
): void => {
  db.update(threads)
    .set({
      providerId: args.providerId,
      providerThreadId: args.providerThreadId,
      updatedAt: Date.now(),
    })
    .where(eq(threads.id, args.threadId))
    .run();
};

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

const applyThreadLifecycleEventRecord = (
  db: ThreadWriteConnection,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome => {
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
      activeTurnId: thread.activeTurnId,
      archivedAt: thread.archivedAt,
      status: thread.status,
    },
  });
  if ("noop" in evaluation) {
    return {
      applied: false,
      detail: evaluation.detail,
      reason: evaluation.noop,
    };
  }

  // the turn id is in the predicate so a settle validated against turn a cannot land after
  // turn b bound.
  const updated = db
    .update(threads)
    .set({ activeTurnId: evaluation.activeTurnId, status: evaluation.to, updatedAt: Date.now() })
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
  if (updated === undefined) {
    return {
      applied: false,
      detail: `status changed from ${thread.status} while applying ${args.event.type}`,
      reason: "cas-conflict",
    };
  }
  return { applied: true, thread: updated };
};

export const applyThreadLifecycleEvent = (
  db: DbConnection,
  notifier: DbNotifier,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome => {
  const outcome = writeTransaction(db, (tx) => applyThreadLifecycleEventRecord(tx, args));
  if (outcome.applied) {
    notifier.notifyThread(args.threadId, ["status-changed"]);
  }
  return outcome;
};

export const applyThreadLifecycleEventInTransaction = (
  tx: DbTransaction,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome => applyThreadLifecycleEventRecord(tx, args);
