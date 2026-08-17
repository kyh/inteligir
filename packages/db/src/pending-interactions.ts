// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { DbConnection } from "./connection";
import { createPendingInteractionId } from "./ids";
import type { DbNotifier } from "@repo/domain/notifier";
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

/** Every open interaction this host holds, across threads — what a client
 *  asking "what is waiting on me?" needs in ONE query instead of a walk of
 *  the thread list. Same order as the per-thread listing. */
export function listAllOpenPendingInteractions(db: DbConnection): PendingInteractionRow[] {
  return db
    .select()
    .from(pendingInteractions)
    .where(inArray(pendingInteractions.status, ["pending", "resolving"]))
    .orderBy(asc(pendingInteractions.createdAt), asc(pendingInteractions.id))
    .all();
}

/** Settle ONE still-open interaction as interrupted (e.g. its wait timed out). */
export function interruptPendingInteraction(
  db: DbConnection,
  notifier: DbNotifier,
  args: { id: string; threadId: string },
): boolean {
  const now = Date.now();
  const updated = db
    .update(pendingInteractions)
    .set({ status: "interrupted", resolvedAt: now, updatedAt: now })
    .where(
      and(
        eq(pendingInteractions.id, args.id),
        eq(pendingInteractions.threadId, args.threadId),
        inArray(pendingInteractions.status, ["pending", "resolving"]),
      ),
    )
    .returning()
    .get();
  if (updated) {
    notifier.notifyThread(args.threadId, ["interactions-changed"]);
    return true;
  }
  return false;
}

/**
 * Settle every still-open interaction for a thread as interrupted — the turn
 * they belonged to ended (completed, failed, or the provider went away), so
 * there is nothing left to answer.
 */
export function interruptOpenPendingInteractions(
  db: DbConnection,
  notifier: DbNotifier,
  threadId: string,
): number {
  const now = Date.now();
  const interrupted = db
    .update(pendingInteractions)
    .set({ status: "interrupted", resolvedAt: now, updatedAt: now })
    .where(
      and(
        eq(pendingInteractions.threadId, threadId),
        inArray(pendingInteractions.status, ["pending", "resolving"]),
      ),
    )
    .returning()
    .all();
  if (interrupted.length > 0) {
    notifier.notifyThread(threadId, ["interactions-changed"]);
  }
  return interrupted.length;
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

/**
 * Open-interaction counts for many threads in ONE grouped query. The chip data
 * for a doc needs a count per bound thread, and a query per thread turns one
 * render into N round trips on every thread invalidation.
 */
export function countOpenPendingInteractionsByThread(
  db: DbConnection,
  threadIds: readonly string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  if (threadIds.length === 0) {
    return counts;
  }
  const rows = db
    .select({ threadId: pendingInteractions.threadId, total: count() })
    .from(pendingInteractions)
    .where(
      and(
        inArray(pendingInteractions.threadId, [...threadIds]),
        inArray(pendingInteractions.status, ["pending", "resolving"]),
      ),
    )
    .groupBy(pendingInteractions.threadId)
    .all();
  for (const row of rows) {
    counts.set(row.threadId, row.total);
  }
  return counts;
}
