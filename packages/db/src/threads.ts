// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type {
  ThreadLifecycleEvent,
  ThreadLifecycleNoopReason,
} from "@repo/domain/thread-lifecycle";
import { evaluateThreadLifecycleEvent } from "@repo/domain/thread-lifecycle";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { DbConnection, DbTransaction } from "./connection";
import { createThreadId } from "./ids";
import type { DbNotifier } from "@repo/domain/notifier";
import { threads } from "./schema";

export type ThreadRow = typeof threads.$inferSelect;

type ThreadWriteConnection = DbConnection | DbTransaction;

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
