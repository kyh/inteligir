// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type {
  ThreadLifecycleEvent,
  ThreadLifecycleNoopReason,
} from "@repo/domain/thread-lifecycle";
import { evaluateThreadLifecycleEvent } from "@repo/domain/thread-lifecycle";
import { isThreadRunning, threadStatusValues } from "@repo/domain/thread-status";
import { and, desc, eq, inArray, isNotNull, isNull, like, sql } from "drizzle-orm";
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

// a row's place in the listing: live before archived, then newest first, the id breaking a tie
// on the millisecond.
export interface ThreadListPosition {
  archived: boolean;
  updatedAt: number;
  id: string;
}

export interface ThreadListQuery {
  // the last row of the previous page; null starts at the top.
  after: ThreadListPosition | null;
  includeArchived: boolean;
  limit: number;
  originDocPath: string | null;
  running: boolean;
}

export interface ThreadPage {
  rows: ThreadRow[];
  // the last row's position when more follow, else null.
  next: ThreadListPosition | null;
}

const RUNNING_STATUSES = threadStatusValues.filter(isThreadRunning);

const positionOf = (row: ThreadRow): ThreadListPosition => ({
  archived: row.archivedAt !== null,
  id: row.id,
  updatedAt: row.updatedAt,
});

const listSegment = (
  db: DbConnection,
  query: ThreadListQuery,
  archived: boolean,
  take: number,
): ThreadRow[] => {
  const after = query.after?.archived === archived ? query.after : null;
  return db
    .select()
    .from(threads)
    .where(
      and(
        archived ? isNotNull(threads.archivedAt) : isNull(threads.archivedAt),
        after === null
          ? undefined
          : sql`(${threads.updatedAt}, ${threads.id}) < (${after.updatedAt}, ${after.id})`,
        query.originDocPath === null ? undefined : eq(threads.originDocPath, query.originDocPath),
        query.running ? inArray(threads.status, RUNNING_STATUSES) : undefined,
      ),
    )
    .orderBy(desc(threads.updatedAt), desc(threads.id))
    .limit(take)
    .all();
};

// one scan per segment, so each is answered by its own partial index instead of a temp b-tree
// sort; one row past the limit says whether another page follows.
export const listThreads = (db: DbConnection, query: ThreadListQuery): ThreadPage => {
  const rows: ThreadRow[] = [];
  const segments = query.includeArchived ? [false, true] : [false];
  for (const archived of segments) {
    if (query.after?.archived === true && !archived) {
      continue;
    }
    rows.push(...listSegment(db, query, archived, query.limit + 1 - rows.length));
    if (rows.length > query.limit) {
      break;
    }
  }
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    next: rows.length > query.limit && last !== undefined ? positionOf(last) : null,
    rows: page,
  };
};

// every one, unpaged: the boot's crash recovery must reach each turn left running.
export const listRunningThreads = (db: DbConnection): ThreadRow[] =>
  db.select().from(threads).where(inArray(threads.status, RUNNING_STATUSES)).all();

// one transaction: a folder's threads move together or not at all, and the announcements follow
// the commit.
export const rebindThreadOrigins = (
  db: DbConnection,
  notifier: DbNotifier,
  args: { from: string; to: string },
): number => {
  const moved = writeTransaction(db, (tx) => {
    const ids = tx
      .update(threads)
      .set({ originDocPath: args.to, updatedAt: Date.now() })
      .where(eq(threads.originDocPath, args.from))
      .returning({ id: threads.id })
      .all()
      .map((row) => row.id);
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
      tx.update(threads)
        .set({
          originDocPath: `${args.to}/${row.originDocPath.slice(prefix.length)}`,
          updatedAt: Date.now(),
        })
        .where(eq(threads.id, row.id))
        .run();
      ids.push(row.id);
    }
    return ids;
  });
  for (const id of moved) {
    notifier.notifyThread(id, ["origin-changed"]);
  }
  return moved.length;
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
