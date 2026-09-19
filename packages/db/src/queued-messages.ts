// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { writeTransaction } from "./connection";
import type { DbConnection, DbTransaction } from "./connection";
import { createPrefixedId, createQueuedThreadMessageId } from "./ids";
import type { DbNotifier } from "@repo/domain/notifier";
import { queuedThreadMessages } from "./schema";

export type QueuedThreadMessageRow = typeof queuedThreadMessages.$inferSelect;

export interface ClaimedQueuedThreadMessageRow extends QueuedThreadMessageRow {
  claimedAt: number;
  claimToken: string;
}

const requireClaimedQueuedThreadMessage = (
  row: QueuedThreadMessageRow | undefined,
): ClaimedQueuedThreadMessageRow | null => {
  if (!row || row.claimedAt === null || row.claimToken === null) {
    return null;
  }
  return { ...row, claimToken: row.claimToken, claimedAt: row.claimedAt };
};

export interface CreateQueuedThreadMessageInput {
  threadId: string;
  text: string;
}

// fixed-width ms timestamp so lexicographic order is arrival order; extended past the tail when
// a burst lands inside one millisecond, because the drain's id tie-break is a random nanoid.
const createSortKeyAfter = (tailSortKey: string | null, now: number): string => {
  const candidate = String(now).padStart(14, "0");
  if (tailSortKey === null || candidate > tailSortKey) {
    return candidate;
  }
  return `${tailSortKey}~`;
};

export const createQueuedThreadMessageInTransaction = (
  tx: DbTransaction,
  input: CreateQueuedThreadMessageInput,
): QueuedThreadMessageRow => {
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
      claimToken: null,
      claimedAt: null,
      createdAt: now,
      id: createQueuedThreadMessageId(),
      sortKey: createSortKeyAfter(tail?.sortKey ?? null, now),
      text: input.text,
      threadId: input.threadId,
      updatedAt: now,
    })
    .returning()
    .get();
};

export const createQueuedThreadMessage = (
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateQueuedThreadMessageInput,
): QueuedThreadMessageRow => {
  const row = writeTransaction(db, (tx) => createQueuedThreadMessageInTransaction(tx, input));
  notifier.notifyThread(input.threadId, ["queue-changed"]);
  return row;
};

export const listQueuedThreadMessages = (
  db: DbConnection,
  threadId: string,
): QueuedThreadMessageRow[] =>
  db
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

// select then cas-update in one transaction: the loser of a race matches nothing and takes the
// next row.
export const claimNextQueuedThreadMessageInTransaction = (
  tx: DbTransaction,
  threadId: string,
): ClaimedQueuedThreadMessageRow | null => {
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
    .set({ claimToken: createPrefixedId("claim"), claimedAt: now, updatedAt: now })
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
};

export const claimNextQueuedThreadMessage = (
  db: DbConnection,
  notifier: DbNotifier,
  threadId: string,
): ClaimedQueuedThreadMessageRow | null => {
  const claimed = writeTransaction(db, (tx) =>
    claimNextQueuedThreadMessageInTransaction(tx, threadId),
  );
  if (claimed) {
    notifier.notifyThread(claimed.threadId, ["queue-changed"]);
  }
  return claimed;
};

export interface ClaimedQueuedThreadMessageKey {
  id: string;
  claimToken: string;
}

export const deleteClaimedQueuedThreadMessageInTransaction = (
  tx: DbTransaction,
  key: ClaimedQueuedThreadMessageKey,
): boolean =>
  tx
    .delete(queuedThreadMessages)
    .where(
      and(eq(queuedThreadMessages.id, key.id), eq(queuedThreadMessages.claimToken, key.claimToken)),
    )
    .returning({ threadId: queuedThreadMessages.threadId })
    .get() !== undefined;

export const deleteClaimedQueuedThreadMessage = (
  db: DbConnection,
  notifier: DbNotifier,
  key: ClaimedQueuedThreadMessageKey,
): boolean => {
  const result = db
    .delete(queuedThreadMessages)
    .where(
      and(eq(queuedThreadMessages.id, key.id), eq(queuedThreadMessages.claimToken, key.claimToken)),
    )
    .returning({ threadId: queuedThreadMessages.threadId })
    .get();
  if (result !== undefined) {
    notifier.notifyThread(result.threadId, ["queue-changed"]);
    return true;
  }
  return false;
};

// a claim has no ttl, so a kill between the drain's ingest commit and its delete would hide the
// row forever. one server owns a data dir, so no claim can be live at boot.
export const releaseAllQueuedMessageClaims = (db: DbConnection): number =>
  db
    .update(queuedThreadMessages)
    .set({ claimToken: null, claimedAt: null, updatedAt: Date.now() })
    .where(isNotNull(queuedThreadMessages.claimToken))
    .returning({ id: queuedThreadMessages.id })
    .all().length;

export const releaseQueuedMessageClaim = (
  db: DbConnection,
  notifier: DbNotifier,
  key: ClaimedQueuedThreadMessageKey,
): boolean => {
  const result = db
    .update(queuedThreadMessages)
    .set({ claimToken: null, claimedAt: null, updatedAt: Date.now() })
    .where(
      and(eq(queuedThreadMessages.id, key.id), eq(queuedThreadMessages.claimToken, key.claimToken)),
    )
    .returning({ threadId: queuedThreadMessages.threadId })
    .get();
  if (result !== undefined) {
    notifier.notifyThread(result.threadId, ["queue-changed"]);
    return true;
  }
  return false;
};
