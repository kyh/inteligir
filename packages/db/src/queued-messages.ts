// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DbConnection, DbTransaction } from "./connection";
import { createPrefixedId, createQueuedThreadMessageId } from "./ids";
import type { DbNotifier } from "./notifier";
import { queuedThreadMessages } from "./schema";

export type QueuedThreadMessageRow = typeof queuedThreadMessages.$inferSelect;

export interface ClaimedQueuedThreadMessageRow extends QueuedThreadMessageRow {
  claimedAt: number;
  claimToken: string;
}

function requireClaimedQueuedThreadMessage(
  row: QueuedThreadMessageRow | undefined,
): ClaimedQueuedThreadMessageRow | null {
  if (!row || row.claimedAt === null || row.claimToken === null) {
    return null;
  }
  return { ...row, claimedAt: row.claimedAt, claimToken: row.claimToken };
}

export interface CreateQueuedThreadMessageInput {
  threadId: string;
  text: string;
}

/**
 * Millisecond timestamp, fixed width so lexicographic order is arrival
 * order — extended past the thread's current tail when a burst lands inside
 * one millisecond, because the drain's id tie-break is a random nanoid and
 * FIFO must not depend on it.
 */
function createSortKeyAfter(tailSortKey: string | null, now: number): string {
  const candidate = String(now).padStart(14, "0");
  if (tailSortKey === null || candidate > tailSortKey) {
    return candidate;
  }
  return `${tailSortKey}~`;
}

/** The caller owns notification (it holds the transaction). */
export function createQueuedThreadMessageInTransaction(
  tx: DbTransaction,
  input: CreateQueuedThreadMessageInput,
): QueuedThreadMessageRow {
  const now = Date.now();
  const tail = tx
    .select({ sortKey: queuedThreadMessages.sortKey })
    .from(queuedThreadMessages)
    .where(eq(queuedThreadMessages.threadId, input.threadId))
    .orderBy(desc(queuedThreadMessages.sortKey))
    .limit(1)
    .get();
  return tx
    .insert(queuedThreadMessages)
    .values({
      id: createQueuedThreadMessageId(),
      threadId: input.threadId,
      text: input.text,
      claimedAt: null,
      claimToken: null,
      sortKey: createSortKeyAfter(tail?.sortKey ?? null, now),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function createQueuedThreadMessage(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateQueuedThreadMessageInput,
): QueuedThreadMessageRow {
  const row = db.transaction((tx) => createQueuedThreadMessageInTransaction(tx, input), {
    behavior: "immediate",
  });
  notifier.notifyThread(input.threadId, ["queue-changed"]);
  return row;
}

export function listQueuedThreadMessages(
  db: DbConnection,
  threadId: string,
): QueuedThreadMessageRow[] {
  return db
    .select()
    .from(queuedThreadMessages)
    .where(
      and(
        eq(queuedThreadMessages.threadId, threadId),
        isNull(queuedThreadMessages.claimedAt),
        isNull(queuedThreadMessages.claimToken),
      ),
    )
    .orderBy(asc(queuedThreadMessages.sortKey), asc(queuedThreadMessages.id))
    .all();
}

/**
 * Claim the next unclaimed message: select and CAS-update under one
 * transaction, so two drains racing for the same row cannot both hold it —
 * the loser's UPDATE matches nothing and it claims the next row or nothing.
 * The caller owns notification (it holds the transaction).
 */
export function claimNextQueuedThreadMessageInTransaction(
  tx: DbTransaction,
  threadId: string,
): ClaimedQueuedThreadMessageRow | null {
  const next = tx
    .select()
    .from(queuedThreadMessages)
    .where(
      and(
        eq(queuedThreadMessages.threadId, threadId),
        isNull(queuedThreadMessages.claimedAt),
        isNull(queuedThreadMessages.claimToken),
      ),
    )
    .orderBy(asc(queuedThreadMessages.sortKey), asc(queuedThreadMessages.id))
    .limit(1)
    .get();
  if (!next) {
    return null;
  }

  const now = Date.now();
  const updated = tx
    .update(queuedThreadMessages)
    .set({ claimedAt: now, claimToken: createPrefixedId("claim"), updatedAt: now })
    .where(
      and(
        eq(queuedThreadMessages.id, next.id),
        isNull(queuedThreadMessages.claimedAt),
        isNull(queuedThreadMessages.claimToken),
      ),
    )
    .returning()
    .get();
  return requireClaimedQueuedThreadMessage(updated);
}

export function claimNextQueuedThreadMessage(
  db: DbConnection,
  notifier: DbNotifier,
  threadId: string,
): ClaimedQueuedThreadMessageRow | null {
  const claimed = db.transaction((tx) => claimNextQueuedThreadMessageInTransaction(tx, threadId), {
    behavior: "immediate",
  });
  if (claimed) {
    notifier.notifyThread(claimed.threadId, ["queue-changed"]);
  }
  return claimed;
}

export interface ClaimedQueuedThreadMessageKey {
  id: string;
  claimToken: string;
}

/** Dispatch succeeded: the claimed message leaves the queue for good. */
export function deleteClaimedQueuedThreadMessage(
  db: DbConnection,
  notifier: DbNotifier,
  key: ClaimedQueuedThreadMessageKey,
): boolean {
  const result = db
    .delete(queuedThreadMessages)
    .where(
      and(eq(queuedThreadMessages.id, key.id), eq(queuedThreadMessages.claimToken, key.claimToken)),
    )
    .returning({ threadId: queuedThreadMessages.threadId })
    .get();
  if (result) {
    notifier.notifyThread(result.threadId, ["queue-changed"]);
    return true;
  }
  return false;
}

/** Dispatch failed: the message goes back to the head of the queue. */
export function releaseQueuedMessageClaim(
  db: DbConnection,
  notifier: DbNotifier,
  key: ClaimedQueuedThreadMessageKey,
): boolean {
  const result = db
    .update(queuedThreadMessages)
    .set({ claimedAt: null, claimToken: null, updatedAt: Date.now() })
    .where(
      and(eq(queuedThreadMessages.id, key.id), eq(queuedThreadMessages.claimToken, key.claimToken)),
    )
    .returning({ threadId: queuedThreadMessages.threadId })
    .get();
  if (result) {
    notifier.notifyThread(result.threadId, ["queue-changed"]);
    return true;
  }
  return false;
}

/** Unclaimed queued-message counts for many threads in ONE grouped query —
 *  the same bound the interaction counts take, for the same reason. */
export function countQueuedThreadMessagesByThread(
  db: DbConnection,
  threadIds: readonly string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  if (threadIds.length === 0) {
    return counts;
  }
  const rows = db
    .select({ threadId: queuedThreadMessages.threadId, total: count() })
    .from(queuedThreadMessages)
    .where(
      and(
        inArray(queuedThreadMessages.threadId, [...threadIds]),
        isNull(queuedThreadMessages.claimedAt),
        isNull(queuedThreadMessages.claimToken),
      ),
    )
    .groupBy(queuedThreadMessages.threadId)
    .all();
  for (const row of rows) {
    counts.set(row.threadId, row.total);
  }
  return counts;
}
