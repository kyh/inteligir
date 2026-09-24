// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type {
  ThreadLifecycleEvent,
  ThreadLifecycleNoopReason,
} from "@repo/domain/thread-lifecycle";
import { evaluateThreadLifecycleEvent } from "@repo/domain/thread-lifecycle";
import { and, desc, eq, isNotNull, isNull, like } from "drizzle-orm";
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
// conversation into two. created bare: its title, origin and harness arrive as the log's
// thread/meta rows, through `applyThreadMetaInTransaction`.
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

export interface ReboundThread {
  id: string;
  originDocPath: string;
}

// takes the caller's transaction so a folder's threads move together or not at all.
export const rebindThreadOriginsInTransaction = (
  tx: DbTransaction,
  args: { from: string; to: string },
): ReboundThread[] => {
  const moved = tx
    .update(threads)
    .set({ originDocPath: args.to, updatedAt: Date.now() })
    .where(eq(threads.originDocPath, args.from))
    .returning({ id: threads.id })
    .all()
    .map((row): ReboundThread => ({ id: row.id, originDocPath: args.to }));
  // "/" appended so a sibling sharing the name's prefix (`Notes2/`) is never caught.
  const prefix = `${args.from}/`;
  const descendants = tx
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
    const originDocPath = `${args.to}/${row.originDocPath.slice(prefix.length)}`;
    tx.update(threads)
      .set({ originDocPath, updatedAt: Date.now() })
      .where(eq(threads.id, row.id))
      .run();
    moved.push({ id: row.id, originDocPath });
  }
  return moved;
};

// fills an empty title only: an explicit one, or one an earlier message already set, stays.
export const nameUntitledThreadInTransaction = (
  tx: DbTransaction,
  args: { threadId: string; title: string },
): boolean =>
  tx
    .update(threads)
    .set({ title: args.title, updatedAt: Date.now() })
    .where(and(eq(threads.id, args.threadId), isNull(threads.title)))
    .returning({ id: threads.id })
    .get() !== undefined;

// true when this call archived it: a thread already archived keeps the time it was archived at.
export const archiveThreadInTransaction = (tx: DbTransaction, id: string): boolean => {
  const now = Date.now();
  return (
    tx
      .update(threads)
      .set({ archivedAt: now, updatedAt: now })
      .where(and(eq(threads.id, id), isNull(threads.archivedAt)))
      .returning({ id: threads.id })
      .get() !== undefined
  );
};

export interface ThreadMetaFacts {
  title?: string | undefined;
  originDocPath?: string | undefined;
  providerId?: string | undefined;
}

export interface ThreadMetaChange {
  title: boolean;
  origin: boolean;
}

// a title and an origin take the latest statement: a rename moves the origin, and a title a
// skipping build pulls again lands after the first message already named the thread. a bound
// harness stays, because this device's provider session was opened on it.
export const applyThreadMetaInTransaction = (
  tx: DbTransaction,
  args: { threadId: string; facts: ThreadMetaFacts },
): ThreadMetaChange => {
  const row = getThread(tx, args.threadId);
  if (row === null) {
    return { origin: false, title: false };
  }
  const { originDocPath, providerId, title } = args.facts;
  const patch: Partial<typeof threads.$inferInsert> = {};
  if (title !== undefined && title !== row.title) {
    patch.title = title;
  }
  if (originDocPath !== undefined && originDocPath !== row.originDocPath) {
    patch.originDocPath = originDocPath;
  }
  if (providerId !== undefined && row.providerId === null) {
    patch.providerId = providerId;
  }
  const change = { origin: patch.originDocPath !== undefined, title: patch.title !== undefined };
  if (!change.origin && !change.title && patch.providerId === undefined) {
    return change;
  }
  tx.update(threads)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(threads.id, args.threadId))
    .run();
  return change;
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

export const applyThreadLifecycleEventInTransaction = (
  tx: DbTransaction,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome => {
  const thread = tx.select().from(threads).where(eq(threads.id, args.threadId)).get();
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
  const updated = tx
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
