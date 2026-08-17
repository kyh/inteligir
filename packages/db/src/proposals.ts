// The suggested-edit store (issue #560). Every write announces through the
// DbNotifier on BOTH axes a proposal belongs to — the doc it edits (the
// editor's gutter) and the thread that made it (the dock and the chip) —
// because a proposal is discoverable from either and a client subscribed to
// only one must not have to poll the other.
//
// Staleness is never written here: `pending` is what the store knows, and a
// reader holding the file decides whether that base still matches disk. See
// @repo/domain/proposal-status.

import type { DbNotifier } from "@repo/domain/notifier";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import type { DbConnection, DbTransaction } from "./connection";
import { createProposalId } from "./ids";
import { proposals } from "./schema";

export type ProposalRow = typeof proposals.$inferSelect;

type ProposalWriteConnection = DbConnection | DbTransaction;

export interface CaptureProposalInput {
  threadId: string;
  turnId?: string;
  docPath: string;
  baseRev?: string;
  /** null when the file did not exist at the base revision — a creation. */
  baseHash: string | null;
  baseContent: string;
  /** null when the turn deleted the file. */
  proposedContent: string | null;
}

/**
 * Record what a review-mode turn wrote, SUPERSEDING this thread's pending
 * proposal for the same doc (the unique partial index is the storage-level
 * twin of that rule). Supersession keeps `revision` climbing rather than
 * restarting: a client holding the old pair must be refused, and a reset
 * counter would hand it a number that matches again.
 */
export function captureProposal(
  db: DbConnection,
  notifier: DbNotifier,
  input: CaptureProposalInput,
): ProposalRow {
  const now = Date.now();
  const row = db.transaction(
    (tx) => {
      const existing = tx
        .select()
        .from(proposals)
        .where(
          and(
            eq(proposals.threadId, input.threadId),
            eq(proposals.docPath, input.docPath),
            eq(proposals.status, "pending"),
          ),
        )
        .get();
      const values = {
        threadId: input.threadId,
        turnId: input.turnId ?? null,
        docPath: input.docPath,
        baseRev: input.baseRev ?? null,
        baseHash: input.baseHash,
        baseContent: input.baseContent,
        proposedContent: input.proposedContent,
        status: "pending" as const,
        updatedAt: now,
        resolvedAt: null,
      };
      if (existing !== undefined) {
        // `acceptedHunks` is NOT reset: the count is about bytes that reached
        // disk, and a supersession does not take them back.
        return tx
          .update(proposals)
          .set({ ...values, revision: existing.revision + 1 })
          .where(eq(proposals.id, existing.id))
          .returning()
          .get();
      }
      return tx
        .insert(proposals)
        .values({
          ...values,
          id: createProposalId(),
          revision: 1,
          acceptedHunks: 0,
          createdAt: now,
        })
        .returning()
        .get();
    },
    { behavior: "immediate" },
  );
  notifier.notifyDoc(row.docPath, ["proposals-changed"]);
  notifier.notifyThread(row.threadId, ["proposals-changed"]);
  return row;
}

export function getProposal(db: ProposalWriteConnection, id: string): ProposalRow | null {
  return db.select().from(proposals).where(eq(proposals.id, id)).get() ?? null;
}

export interface ListProposalsFilter {
  docPath?: string;
  threadId?: string;
  /** Omitted lists the pending ones — the review queue, which is what every
   *  surface asks for; a resolved proposal is history. */
  includeResolved?: boolean;
}

export function listProposals(db: DbConnection, filter: ListProposalsFilter): ProposalRow[] {
  const conditions = [
    ...(filter.docPath === undefined ? [] : [eq(proposals.docPath, filter.docPath)]),
    ...(filter.threadId === undefined ? [] : [eq(proposals.threadId, filter.threadId)]),
    ...(filter.includeResolved === true ? [] : [eq(proposals.status, "pending")]),
  ];
  const query = db.select().from(proposals);
  return (conditions.length === 0 ? query : query.where(and(...conditions)))
    .orderBy(desc(proposals.updatedAt))
    .all();
}

/** Pending proposals per thread, for the ids given — the chip's and the
 *  dock's count, as one grouped scan rather than a query per thread. */
export function countPendingProposalsByThread(
  db: DbConnection,
  threadIds: readonly string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  if (threadIds.length === 0) {
    return counts;
  }
  const rows = db
    .select({ threadId: proposals.threadId, count: sql<number>`count(*)` })
    .from(proposals)
    .where(and(inArray(proposals.threadId, [...threadIds]), eq(proposals.status, "pending")))
    .groupBy(proposals.threadId)
    .all();
  for (const row of rows) {
    counts.set(row.threadId, row.count);
  }
  return counts;
}

export type ProposalCasOutcome =
  | { applied: true; proposal: ProposalRow }
  | { applied: false; reason: "not-found" }
  | { applied: false; reason: "revision-mismatch"; proposal: ProposalRow };

export interface RewriteProposalArgs {
  id: string;
  /** The revision the caller's hunks were derived from. */
  expectedRevision: number;
  baseHash: string | null;
  baseContent: string;
  proposedContent: string | null;
  /** How many hunks this rewrite put on disk — 1 for an accept, 0 for a
   *  reject. Added to the running count, never assigned. */
  landedHunks: number;
}

/**
 * Install a new (base, proposed) pair under a revision compare-and-set — how
 * both per-hunk verbs move: an accept advances the base (the hunk is on disk
 * now), a reject retreats the proposal (the hunk is abandoned), and either
 * way the hunk leaves the derived list because the two sides now agree there.
 */
export function rewriteProposal(
  db: DbConnection,
  notifier: DbNotifier,
  args: RewriteProposalArgs,
): ProposalCasOutcome {
  const outcome = casUpdate(db, args.id, args.expectedRevision, (existing) => ({
    baseHash: args.baseHash,
    baseContent: args.baseContent,
    proposedContent: args.proposedContent,
    acceptedHunks: existing.acceptedHunks + args.landedHunks,
    revision: existing.revision + 1,
    updatedAt: Date.now(),
  }));
  announce(notifier, outcome);
  return outcome;
}

export interface ResolveProposalArgs {
  id: string;
  expectedRevision: number;
  /** Hunks this final verb put on disk; added before the status is read off
   *  the total, so the last accept counts towards its own outcome. */
  landedHunks: number;
}

export function resolveProposal(
  db: DbConnection,
  notifier: DbNotifier,
  args: ResolveProposalArgs,
): ProposalCasOutcome {
  const now = Date.now();
  const outcome = casUpdate(db, args.id, args.expectedRevision, (existing) => {
    const accepted = existing.acceptedHunks + args.landedHunks;
    return {
      // What the history says happened is what reached the FILE. A mixed
      // review — some hunks taken, the last one discarded — is an acceptance,
      // because the note carries the agent's edits either way.
      status: accepted > 0 ? ("accepted" as const) : ("rejected" as const),
      acceptedHunks: accepted,
      revision: existing.revision + 1,
      updatedAt: now,
      resolvedAt: now,
    };
  });
  announce(notifier, outcome);
  return outcome;
}

function casUpdate(
  db: DbConnection,
  id: string,
  expectedRevision: number,
  next: (existing: ProposalRow) => Partial<typeof proposals.$inferInsert>,
): ProposalCasOutcome {
  return db.transaction(
    (tx): ProposalCasOutcome => {
      const existing = tx.select().from(proposals).where(eq(proposals.id, id)).get();
      if (existing === undefined) {
        return { applied: false, reason: "not-found" };
      }
      if (existing.revision !== expectedRevision || existing.status !== "pending") {
        return { applied: false, reason: "revision-mismatch", proposal: existing };
      }
      const updated = tx
        .update(proposals)
        .set(next(existing))
        .where(and(eq(proposals.id, id), eq(proposals.revision, expectedRevision)))
        .returning()
        .get();
      if (updated === undefined) {
        return { applied: false, reason: "revision-mismatch", proposal: existing };
      }
      return { applied: true, proposal: updated };
    },
    { behavior: "immediate" },
  );
}

function announce(notifier: DbNotifier, outcome: ProposalCasOutcome): void {
  if (!outcome.applied) {
    return;
  }
  notifier.notifyDoc(outcome.proposal.docPath, ["proposals-changed"]);
  notifier.notifyThread(outcome.proposal.threadId, ["proposals-changed"]);
}
