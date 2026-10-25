// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { and, asc, eq } from "drizzle-orm";
import type { DbConnection } from "./connection";
import { createPendingInteractionId } from "./ids";
import { readJsonColumn } from "./json-column";
import type { DbNotifier } from "@repo/domain/notifier";
import { approvalPendingInteractionPayloadSchema } from "@repo/domain/pending-interactions";
import type {
  ApprovalPendingInteractionPayload,
  PendingInteractionApprovalDecision,
} from "@repo/domain/pending-interactions";
import { pendingInteractions } from "./schema";

type StoredPendingInteraction = typeof pendingInteractions.$inferSelect;

export interface PendingInteractionRow extends Omit<StoredPendingInteraction, "payload"> {
  // null for bytes this grammar refuses: deny is always answerable, so one bad row costs its card's
  // detail rather than the thread.
  payload: ApprovalPendingInteractionPayload | null;
}

const readRow = (stored: StoredPendingInteraction): PendingInteractionRow => ({
  ...stored,
  payload: readJsonColumn(stored.payload, approvalPendingInteractionPayloadSchema),
});

export interface CreatePendingInteractionInput {
  threadId: string;
  turnId?: string;
  requestKey: string;
  payload: ApprovalPendingInteractionPayload;
}

// idempotent on (threadId, requestKey): a provider retrying a request gets its row back, not a
// second prompt.
export const createPendingInteraction = (
  db: DbConnection,
  notifier: DbNotifier,
  input: CreatePendingInteractionInput,
): PendingInteractionRow => {
  const now = Date.now();
  const inserted = db
    .insert(pendingInteractions)
    .values({
      createdAt: now,
      decision: null,
      id: createPendingInteractionId(),
      payload: JSON.stringify(input.payload),
      requestKey: input.requestKey,
      resolvedAt: null,
      status: "pending",
      threadId: input.threadId,
      turnId: input.turnId ?? null,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning()
    .get();
  if (inserted !== undefined) {
    notifier.notifyThread(input.threadId, ["interactions-changed"]);
    return readRow(inserted);
  }
  const existing = db
    .select()
    .from(pendingInteractions)
    .where(
      and(
        eq(pendingInteractions.threadId, input.threadId),
        eq(pendingInteractions.requestKey, input.requestKey),
      ),
    )
    .get();
  if (!existing) {
    throw new Error("pending interaction conflicted but no existing row was found");
  }
  return readRow(existing);
};

export const getPendingInteraction = (
  db: DbConnection,
  id: string,
): PendingInteractionRow | null => {
  const stored = db.select().from(pendingInteractions).where(eq(pendingInteractions.id, id)).get();
  return stored === undefined ? null : readRow(stored);
};

export const listOpenPendingInteractions = (
  db: DbConnection,
  threadId: string,
): PendingInteractionRow[] =>
  db
    .select()
    .from(pendingInteractions)
    .where(
      and(eq(pendingInteractions.threadId, threadId), eq(pendingInteractions.status, "pending")),
    )
    .orderBy(asc(pendingInteractions.createdAt), asc(pendingInteractions.id))
    .all()
    .map(readRow);

// settled ones included: an answer delivered twice finds the row its first delivery resolved
export const listThreadPendingInteractions = (
  db: DbConnection,
  threadId: string,
): PendingInteractionRow[] =>
  db
    .select()
    .from(pendingInteractions)
    .where(eq(pendingInteractions.threadId, threadId))
    .orderBy(asc(pendingInteractions.createdAt), asc(pendingInteractions.id))
    .all()
    .map(readRow);

export const interruptPendingInteraction = (
  db: DbConnection,
  notifier: DbNotifier,
  args: { id: string; threadId: string },
): boolean => {
  const now = Date.now();
  const updated = db
    .update(pendingInteractions)
    .set({ resolvedAt: now, status: "interrupted", updatedAt: now })
    .where(
      and(
        eq(pendingInteractions.id, args.id),
        eq(pendingInteractions.threadId, args.threadId),
        eq(pendingInteractions.status, "pending"),
      ),
    )
    .returning()
    .get();
  if (updated !== undefined) {
    notifier.notifyThread(args.threadId, ["interactions-changed"]);
    return true;
  }
  return false;
};

export const interruptOpenPendingInteractions = (
  db: DbConnection,
  notifier: DbNotifier,
  threadId: string,
): number => {
  const now = Date.now();
  const interrupted = db
    .update(pendingInteractions)
    .set({ resolvedAt: now, status: "interrupted", updatedAt: now })
    .where(
      and(eq(pendingInteractions.threadId, threadId), eq(pendingInteractions.status, "pending")),
    )
    .returning()
    .all();
  if (interrupted.length > 0) {
    notifier.notifyThread(threadId, ["interactions-changed"]);
  }
  return interrupted.length;
};

export type ResolvePendingInteractionOutcome =
  | { kind: "resolved"; interaction: PendingInteractionRow }
  | { kind: "not-found" }
  | { kind: "already-resolved"; interaction: PendingInteractionRow };

export interface ResolvePendingInteractionArgs {
  id: string;
  threadId: string;
  decision: PendingInteractionApprovalDecision;
}

export const resolvePendingInteraction = (
  db: DbConnection,
  notifier: DbNotifier,
  args: ResolvePendingInteractionArgs,
): ResolvePendingInteractionOutcome => {
  const now = Date.now();
  const updated = db
    .update(pendingInteractions)
    .set({ decision: args.decision, resolvedAt: now, status: "resolved", updatedAt: now })
    .where(
      and(
        eq(pendingInteractions.id, args.id),
        eq(pendingInteractions.threadId, args.threadId),
        eq(pendingInteractions.status, "pending"),
      ),
    )
    .returning()
    .get();
  if (updated !== undefined) {
    notifier.notifyThread(args.threadId, ["interactions-changed"]);
    return { interaction: readRow(updated), kind: "resolved" };
  }
  const existing = getPendingInteraction(db, args.id);
  if (existing === null || existing.threadId !== args.threadId) {
    return { kind: "not-found" };
  }
  return { interaction: existing, kind: "already-resolved" };
};
