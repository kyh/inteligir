// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DbConnection, DbTransaction } from "./connection";
import { createPrefixedId, createQueuedThreadMessageId } from "./ids";
import { readJsonColumn } from "./json-column";
import { actionPresetSchema } from "@repo/domain/action-preset";
import type { ActionPreset } from "@repo/domain/action-preset";
import type { DbNotifier } from "@repo/domain/notifier";
import { queuedThreadMessages } from "./schema";

type StoredQueuedThreadMessage = typeof queuedThreadMessages.$inferSelect;

export interface QueuedThreadMessageRow extends Omit<
  StoredQueuedThreadMessage,
  "contextPaths" | "preset"
> {
  // null for none, and for bytes that no longer parse: those cost the message its attachments,
  // never the message.
  contextPaths: string[] | null;
  // null for none, and for a name this build has no preset for: the message still runs as typed.
  preset: ActionPreset | null;
}

export interface ClaimedQueuedThreadMessageRow extends QueuedThreadMessageRow {
  claimedAt: number;
  claimToken: string;
}

const storedContextPathsSchema = z.array(z.string().min(1)).min(1);

const readPreset = (stored: string | null): ActionPreset | null => {
  const parsed = actionPresetSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
};

const readRow = (stored: StoredQueuedThreadMessage): QueuedThreadMessageRow => ({
  ...stored,
  contextPaths:
    stored.contextPaths === null
      ? null
      : readJsonColumn(stored.contextPaths, storedContextPathsSchema),
  preset: readPreset(stored.preset),
});

const requireClaimedQueuedThreadMessage = (
  stored: StoredQueuedThreadMessage | undefined,
): ClaimedQueuedThreadMessageRow | null => {
  if (!stored || stored.claimedAt === null || stored.claimToken === null) {
    return null;
  }
  return { ...readRow(stored), claimToken: stored.claimToken, claimedAt: stored.claimedAt };
};

export interface CreateQueuedThreadMessageInput {
  threadId: string;
  text: string;
  contextPaths: readonly string[] | null;
  // the named action the message asks for, null for none
  preset: ActionPreset | null;
  // the phone's dispatch this message carries out, null for one typed here
  dispatchId: string | null;
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
  const inserted = tx
    .insert(queuedThreadMessages)
    .values({
      claimToken: null,
      claimedAt: null,
      contextPaths: input.contextPaths === null ? null : JSON.stringify(input.contextPaths),
      createdAt: now,
      dispatchId: input.dispatchId,
      id: createQueuedThreadMessageId(),
      preset: input.preset,
      sortKey: createSortKeyAfter(tail?.sortKey ?? null, now),
      text: input.text,
      threadId: input.threadId,
      updatedAt: now,
    })
    .returning()
    .get();
  return readRow(inserted);
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
    .all()
    .map(readRow);

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
