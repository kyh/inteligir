// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { writeTransaction, type DbConnection, type DbTransaction } from "./connection";
import { createPrefixedId, createQueuedThreadMessageId } from "./ids";
import type { DbNotifier } from "@repo/domain/notifier";
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

// fixed-width ms timestamp so lexicographic order is arrival order; extended past the tail when
// a burst lands inside one millisecond, because the drain's id tie-break is a random nanoid.
function createSortKeyAfter(tailSortKey: string | null, now: number): string {
  const candidate = String(now).padStart(14, "0");
  if (tailSortKey === null || candidate > tailSortKey) {
    return candidate;
  }
  return `${tailSortKey}~`;
}

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
  const row = writeTransaction(db, (tx) => createQueuedThreadMessageInTransaction(tx, input));
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

// select then cas-update in one transaction: the loser of a race matches nothing and takes the
// next row.
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
  const claimed = writeTransaction(db, (tx) =>
    claimNextQueuedThreadMessageInTransaction(tx, threadId),
  );
  if (claimed) {
    notifier.notifyThread(claimed.threadId, ["queue-changed"]);
  }
  return claimed;
}

export interface ClaimedQueuedThreadMessageKey {
  id: string;
  claimToken: string;
}

export function deleteClaimedQueuedThreadMessageInTransaction(
  tx: DbTransaction,
  key: ClaimedQueuedThreadMessageKey,
): boolean {
  return (
    tx
      .delete(queuedThreadMessages)
      .where(
        and(
          eq(queuedThreadMessages.id, key.id),
          eq(queuedThreadMessages.claimToken, key.claimToken),
        ),
      )
      .returning({ threadId: queuedThreadMessages.threadId })
      .get() !== undefined
  );
}

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

// a claim has no ttl, so a kill between the drain's ingest commit and its delete would hide the
// row forever. one server owns a data dir, so no claim can be live at boot.
export function releaseAllQueuedMessageClaims(db: DbConnection): number {
  return db
    .update(queuedThreadMessages)
    .set({ claimedAt: null, claimToken: null, updatedAt: Date.now() })
    .where(isNotNull(queuedThreadMessages.claimToken))
    .returning({ id: queuedThreadMessages.id })
    .all().length;
}

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
