// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type {
  ThreadLifecycleEvent,
  ThreadLifecycleNoopReason,
} from "@repo/domain/thread-lifecycle";
import { evaluateThreadLifecycleEvent } from "@repo/domain/thread-lifecycle";
import { isThreadRunning, threadStatusValues } from "@repo/domain/thread-status";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DbConnection, DbExecutor, DbTransaction } from "./connection";
import { createThreadId } from "./ids";
import type { DbNotifier } from "@repo/domain/notifier";
import { threads } from "./schema";

export type ThreadRow = typeof threads.$inferSelect;

// the note's path at compose time and its frontmatter `id`, null for a note that has none; the
// columns are independent, so this shape is what keeps an id from arriving without its path.
export interface ThreadOriginInput {
  path: string;
  noteId: string | null;
}

export interface CreateThreadInput {
  title?: string;
  origin?: ThreadOriginInput;
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
      originDocPath: input.origin?.path ?? null,
      originNoteId: input.origin?.noteId ?? null,
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

export const getThread = (db: DbExecutor, id: string): ThreadRow | null =>
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
  // the note's path and, when it carries one, its frontmatter `id`: a thread bound to that id is
  // the note's wherever it was composed, so the caller re-checks each row's resolved origin.
  origin: ThreadOriginInput | null;
  // text the title or the stored origin path holds, ascii case folded as LIKE folds it.
  contains: string | null;
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

const originPredicate = (origin: ThreadOriginInput | null): SQL | undefined => {
  if (origin === null) {
    return undefined;
  }
  const byPath = eq(threads.originDocPath, origin.path);
  return origin.noteId === null ? byPath : or(byPath, eq(threads.originNoteId, origin.noteId));
};

// LIKE's wildcards and its escape character match only themselves.
const containsPredicate = (text: string | null): SQL | undefined => {
  if (text === null) {
    return undefined;
  }
  const pattern = `%${text.replaceAll(/[\\%_]/gu, "\\$&")}%`;
  return sql`(${threads.title} LIKE ${pattern} ESCAPE '\\' OR ${threads.originDocPath} LIKE ${pattern} ESCAPE '\\')`;
};

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
        originPredicate(query.origin),
        containsPredicate(query.contains),
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

// the paths threads are bound by alone: composed over a note with no id to give, or before the
// id column existed.
export const listPathOnlyOriginPaths = (db: DbExecutor): string[] =>
  db
    .selectDistinct({ path: threads.originDocPath })
    .from(threads)
    .where(and(isNotNull(threads.originDocPath), isNull(threads.originNoteId)))
    .all()
    .flatMap((row) => (row.path === null ? [] : [row.path]));

// only rows still bound by that path alone: a thread/meta that restated an origin meanwhile is the
// newer statement, and an id never pairs with another statement's path. updated_at stays, because
// the listing orders by it and nothing about the thread changed.
export const bindPathOnlyOrigins = (
  db: DbExecutor,
  args: { path: string; noteId: string },
): void => {
  db.update(threads)
    .set({ originNoteId: args.noteId })
    .where(and(eq(threads.originDocPath, args.path), isNull(threads.originNoteId)))
    .run();
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
  originNoteId?: string | undefined;
  providerId?: string | undefined;
}

export interface ThreadMetaChange {
  title: boolean;
  origin: boolean;
}

// a title and an origin take the latest statement: a title a skipping build pulls again lands
// after the first message already named the thread. an origin is stated as its path and its note's
// id together, so an id never pairs with another statement's path. a bound harness stays, because
// this device's provider session was opened on it.
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
  if (originDocPath !== undefined) {
    const originNoteId = args.facts.originNoteId ?? null;
    if (originDocPath !== row.originDocPath || originNoteId !== row.originNoteId) {
      patch.originDocPath = originDocPath;
      patch.originNoteId = originNoteId;
    }
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
