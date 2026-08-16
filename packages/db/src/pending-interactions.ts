// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbConnection } from "./connection";
import { createPendingInteractionId } from "./ids";
import type { DbNotifier } from "./notifier";
import { pendingInteractions } from "./schema";

export type PendingInteractionRow = typeof pendingInteractions.$inferSelect;

export interface CreatePendingInteractionInput {
  threadId: string;
  turnId?: string;
  /** The provider's own request identity — see the schema's unique index. */
  requestKey: string;
  /** JSON-serialized interaction subject; the contract parses it back out. */
  payload: string;
}

/**
 * Idempotent on (threadId, requestKey): a provider retrying a request it
 * never saw answered gets its existing row back instead of raising a second
 * prompt.
 */
export function createPendingInteraction(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreatePendingInteractionInput,
): PendingInteractionRow {
  const now = Date.now();
  const inserted = db
    .insert(pendingInteractions)
    .values({
      id: createPendingInteractionId(),
      threadId: input.threadId,
      turnId: input.turnId ?? null,
      requestKey: input.requestKey,
      status: "pending",
      payload: input.payload,
      resolution: null,
      createdAt: now,
      resolvedAt: null,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning()
    .get();
  if (inserted) {
    notifier.notifyThread(input.threadId, ["interactions-changed"]);
    return inserted;
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
  return existing;
}

export function getPendingInteraction(db: DbConnection, id: string): PendingInteractionRow | null {
  return db.select().from(pendingInteractions).where(eq(pendingInteractions.id, id)).get() ?? null;
}

export function listOpenPendingInteractions(
  db: DbConnection,
  threadId: string,
): PendingInteractionRow[] {
  return db
    .select()
    .from(pendingInteractions)
    .where(
      and(
        eq(pendingInteractions.threadId, threadId),
        inArray(pendingInteractions.status, ["pending", "resolving"]),
      ),
    )
    .orderBy(asc(pendingInteractions.createdAt), asc(pendingInteractions.id))
    .all();
}

export type ResolvePendingInteractionOutcome =
  | { kind: "resolved"; interaction: PendingInteractionRow }
  | { kind: "not-found" }
  | { kind: "already-resolved"; interaction: PendingInteractionRow };

export interface ResolvePendingInteractionArgs {
  id: string;
  threadId: string;
  resolution: string;
}

/** CAS on status: only a pending row can be answered, exactly once. */
export function resolvePendingInteraction(
  db: DbConnection,
  notifier: DbNotifier,
  args: ResolvePendingInteractionArgs,
): ResolvePendingInteractionOutcome {
  const now = Date.now();
  const updated = db
    .update(pendingInteractions)
    .set({ status: "resolved", resolution: args.resolution, resolvedAt: now, updatedAt: now })
    .where(
      and(
        eq(pendingInteractions.id, args.id),
        eq(pendingInteractions.threadId, args.threadId),
        eq(pendingInteractions.status, "pending"),
      ),
    )
    .returning()
    .get();
  if (updated) {
    notifier.notifyThread(args.threadId, ["interactions-changed"]);
    return { kind: "resolved", interaction: updated };
  }
  const existing = getPendingInteraction(db, args.id);
  if (existing === null || existing.threadId !== args.threadId) {
    return { kind: "not-found" };
  }
  return { kind: "already-resolved", interaction: existing };
}
