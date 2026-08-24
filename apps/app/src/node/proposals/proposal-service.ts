// Reviewing a suggested edit (issue #560).
//
// AN ACCEPT IS AN ORDINARY VAULT WRITE. It goes through `writeGuarded` with
// the proposal's own base hash as `expectedHash`, which is the same
// compare-and-swap a user's save takes — so the knowledge index projects it,
// git commits it on the ordinary debounce, the watcher and every open editor
// hear about it, and an accept against a file that moved REFUSES instead of
// clobbering. Nothing here writes bytes any other way.
//
// A per-hunk verb rewrites the (base, proposed) pair rather than resolving
// the row: accepting advances the base past that hunk, rejecting retreats the
// proposal to it, and either way the hunk leaves the derived list because the
// two sides now agree there. A proposal whose list empties is finished, and
// its status is read off how many hunks REACHED DISK, never off which verb
// happened to be last — a mixed review that ends on a reject still left the
// agent's edits in the file, and calling that "rejected" would make the
// history contradict the note. That is why `hunkIndex` needs no separate
// "resolve" call: the last hunk resolves it.
//
// STALENESS IS COMPUTED HERE, per read, by hashing the file. See
// @repo/domain/proposal-status for why it is not a column.

import type { DbConnection } from "@repo/db/connection";
import {
  getProposal,
  listProposals,
  resolveProposal,
  rewriteProposal,
  type ListProposalsFilter,
  type ProposalRow,
} from "@repo/db/proposals";
import type { DbNotifier } from "@repo/domain/notifier";
import { contentHunks, mergeHunks } from "@repo/notes/text/hunk-merge";
import type {
  ListProposalsQuery,
  Proposal,
  ProposalHunk,
} from "@repo/api/local/proposals/proposals-schema";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import { VaultServiceError, type VaultService } from "../vault/vault-service";

export interface ProposalServiceArgs {
  db: DbConnection;
  notifier: DbNotifier;
  vault: VaultService;
}

/** `hunkIndex` omitted resolves the whole proposal — see the header. */
export interface ResolveProposalArgs {
  proposalId: string;
  expectedRevision: number;
  hunkIndex?: number;
}

export type ProposalOutcome =
  | { kind: "resolved"; proposal: Proposal }
  | { kind: "not-found" }
  | { kind: "no-such-hunk"; message: string }
  | { kind: "revision-conflict"; message: string }
  | { kind: "disk-changed"; message: string };

/** What the file holds now: its content, or null when it is not there. */
async function diskContent(vault: VaultService, path: string): Promise<string | null> {
  try {
    return (await vault.read(path)).content;
  } catch (error) {
    if (error instanceof VaultServiceError && error.code === "not_found") {
      return null;
    }
    throw error;
  }
}

export class ProposalService {
  private readonly db: DbConnection;
  private readonly notifier: DbNotifier;
  private readonly vault: VaultService;

  constructor(args: ProposalServiceArgs) {
    this.db = args.db;
    this.notifier = args.notifier;
    this.vault = args.vault;
  }

  async list(query: ListProposalsQuery): Promise<Proposal[]> {
    const filter: ListProposalsFilter = {};
    if (query.docPath !== undefined) filter.docPath = query.docPath;
    if (query.threadId !== undefined) filter.threadId = query.threadId;
    if (query.includeResolved !== undefined) filter.includeResolved = query.includeResolved;
    const rows = listProposals(this.db, filter);
    return Promise.all(rows.map((row) => this.toWire(row)));
  }

  async get(proposalId: string): Promise<Proposal | null> {
    const row = getProposal(this.db, proposalId);
    return row === null ? null : this.toWire(row);
  }

  /**
   * Land the named hunk (or the whole proposal) through the vault's own CAS
   * write, then advance the proposal's base past what landed.
   */
  async accept(args: ResolveProposalArgs): Promise<ProposalOutcome> {
    const row = getProposal(this.db, args.proposalId);
    if (row === null) {
      return { kind: "not-found" };
    }
    if (row.status !== "pending" || row.revision !== args.expectedRevision) {
      return {
        kind: "revision-conflict",
        message: `This suggestion moved on (revision ${row.revision}, status ${row.status}); re-read it before accepting.`,
      };
    }

    if (row.proposedContent === null) {
      return this.acceptDeletion(row);
    }
    const hunks = contentHunks(row.baseContent, row.proposedContent);
    const selected = this.select(hunks, args.hunkIndex);
    if (selected === null) {
      return {
        kind: "no-such-hunk",
        message: `This suggestion has no hunk ${String(args.hunkIndex)}; it carries ${hunks.length}.`,
      };
    }
    const nextBase = mergeHunks(row.baseContent, row.proposedContent, selected);

    const applied = await this.vault.writeGuarded(
      row.docPath,
      nextBase,
      row.baseHash === null ? { ifAbsent: true } : { expectedHash: row.baseHash },
    );
    if (!applied.applied) {
      return {
        kind: "disk-changed",
        message:
          applied.reason === "exists"
            ? `${row.docPath} already exists, so this suggestion cannot create it. Re-run the task against what is there now.`
            : `${row.docPath} changed since this suggestion was computed. Re-run the task rather than applying it to bytes it never saw.`,
      };
    }

    // The bytes are on disk, so they are the base from here on. Whether the
    // proposal is FINISHED is the same question as whether any hunk is left.
    const nextHash = await contentHashHex(nextBase);
    if (nextBase === row.proposedContent) {
      return this.settle(row, args.expectedRevision, selected.size);
    }
    const rewritten = rewriteProposal(this.db, this.notifier, {
      id: row.id,
      expectedRevision: args.expectedRevision,
      baseHash: nextHash,
      baseContent: nextBase,
      proposedContent: row.proposedContent,
      landedHunks: selected.size,
    });
    return this.fromCas(rewritten);
  }

  /** Give a hunk (or the whole suggestion) back to the base. Touches no file. */
  async reject(args: ResolveProposalArgs): Promise<ProposalOutcome> {
    const row = getProposal(this.db, args.proposalId);
    if (row === null) {
      return { kind: "not-found" };
    }
    if (row.status !== "pending" || row.revision !== args.expectedRevision) {
      return {
        kind: "revision-conflict",
        message: `This suggestion moved on (revision ${row.revision}, status ${row.status}); re-read it before rejecting.`,
      };
    }
    if (row.proposedContent === null || args.hunkIndex === undefined) {
      return this.settle(row, args.expectedRevision, 0);
    }
    const hunks = contentHunks(row.baseContent, row.proposedContent);
    const selected = this.select(hunks, args.hunkIndex);
    if (selected === null) {
      return {
        kind: "no-such-hunk",
        message: `This suggestion has no hunk ${String(args.hunkIndex)}; it carries ${hunks.length}.`,
      };
    }
    // The mirror of an accept: the PROPOSAL takes the base's lines there.
    const nextProposed = mergeHunks(row.proposedContent, row.baseContent, selected);
    if (nextProposed === row.baseContent) {
      return this.settle(row, args.expectedRevision, 0);
    }
    return this.fromCas(
      rewriteProposal(this.db, this.notifier, {
        id: row.id,
        expectedRevision: args.expectedRevision,
        baseHash: row.baseHash,
        baseContent: row.baseContent,
        proposedContent: nextProposed,
        landedHunks: 0,
      }),
    );
  }

  /** A deletion carries no hunks — it is accepted whole, through a guarded
   *  remove so a file that changed since is refused like any other CAS. */
  private async acceptDeletion(row: ProposalRow): Promise<ProposalOutcome> {
    const removed = await this.vault.removeIfUnchanged(row.docPath, row.baseContent);
    if (!removed.applied) {
      return {
        kind: "disk-changed",
        message: `${row.docPath} changed since this suggestion was computed, so it was not deleted.`,
      };
    }
    // A deletion is one indivisible change, so landing it counts as one.
    return this.settle(row, row.revision, 1);
  }

  private select(
    hunks: readonly ProposalHunk[],
    hunkIndex: number | undefined,
  ): Set<number> | null {
    if (hunkIndex === undefined) {
      return new Set(hunks.map((hunk) => hunk.index));
    }
    if (!hunks.some((hunk) => hunk.index === hunkIndex)) {
      return null;
    }
    return new Set([hunkIndex]);
  }

  /** Finish the proposal. The status is not passed in — it is read off how
   *  many hunks reached disk in total, which is the only account that cannot
   *  disagree with the file. */
  private settle(row: ProposalRow, expectedRevision: number, landedHunks: number): ProposalOutcome {
    return this.fromCas(
      resolveProposal(this.db, this.notifier, { id: row.id, expectedRevision, landedHunks }),
    );
  }

  private fromCas(
    outcome:
      | { applied: true; proposal: ProposalRow }
      | { applied: false; reason: "not-found" }
      | { applied: false; reason: "revision-mismatch"; proposal: ProposalRow },
  ): ProposalOutcome {
    if (outcome.applied) {
      return {
        kind: "resolved",
        proposal: this.toWireSync(outcome.proposal, outcome.proposal.status),
      };
    }
    if (outcome.reason === "not-found") {
      return { kind: "not-found" };
    }
    return {
      kind: "revision-conflict",
      message: "This suggestion changed while the review was in flight; re-read it and try again.",
    };
  }

  /** The wire shape, with `pending` refined to `stale` when the file on disk
   *  no longer hashes to the base these hunks were computed against. */
  private async toWire(row: ProposalRow): Promise<Proposal> {
    if (row.status !== "pending") {
      return this.toWireSync(row, row.status);
    }
    const disk = await diskContent(this.vault, row.docPath);
    const diskHash = disk === null ? null : await contentHashHex(disk);
    return this.toWireSync(row, diskHash === row.baseHash ? "pending" : "stale");
  }

  private toWireSync(row: ProposalRow, status: Proposal["status"]): Proposal {
    return {
      id: row.id,
      threadId: row.threadId,
      turnId: row.turnId,
      docPath: row.docPath,
      status,
      revision: row.revision,
      baseHash: row.baseHash,
      baseContent: row.baseContent,
      proposedContent: row.proposedContent,
      hunks: row.proposedContent === null ? [] : contentHunks(row.baseContent, row.proposedContent),
      acceptedHunks: row.acceptedHunks,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      resolvedAt: row.resolvedAt,
    };
  }
}
