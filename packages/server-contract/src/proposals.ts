// The suggested-edit wire contract (issue #560): what a review-mode turn
// captured, and the two verbs that resolve it.
//
// A proposal travels WHOLE — both sides' bytes and the derived hunk list —
// because every surface that shows one needs all of it: the editor's gutter
// draws the hunks in place, the dock summarises them, and the CLI prints a
// diff. A list is the review QUEUE (what is pending), not a history, so its
// size is bounded by how much the user has left unreviewed rather than by the
// vault.
//
// Both verbs name the REVISION they act on. Hunk indices are positions in a
// list derived from one (base, proposed) pair, and every accept or reject
// rewrites that pair — so an index rendered a moment ago can name a different
// region now, and a stale caller must be refused rather than applied.

import { proposalStatusSchema } from "@repo/domain/proposal-status";
import type { EmptyInput } from "@repo/typed-routes/endpoint";
import {
  defineRoute,
  jsonRequest,
  jsonResponse,
  optionalQueryRequest,
  queryRequest,
} from "@repo/typed-routes/route-descriptor";
import { z } from "zod";
import type { ApiErrorResponse } from "./errors";
import { vaultPathSchema } from "./vault";

/** One reviewable region of a proposal, in the BASE's line coordinates. */
export const proposalHunkSchema = z
  .object({
    index: z.number().int().min(0),
    baseStart: z.number().int().min(0),
    baseEnd: z.number().int().min(0),
    baseLines: z.array(z.string()),
    proposedLines: z.array(z.string()),
  })
  .strict();
export type ProposalHunk = z.infer<typeof proposalHunkSchema>;

export const proposalSchema = z
  .object({
    id: z.string().min(1),
    threadId: z.string().min(1),
    turnId: z.string().nullable(),
    docPath: z.string().min(1),
    /**
     * `stale` is the READ-TIME refinement of `pending`: the file on disk no
     * longer hashes to `baseHash`, so applying these hunks would land them on
     * bytes they were never computed against. Never stored — see
     * @repo/domain/proposal-status.
     */
    status: proposalStatusSchema,
    /** The identity of the (base, proposed) pair below; both verbs name it. */
    revision: z.number().int().min(1),
    /** null when the file did not exist at the base revision — a creation. */
    baseHash: z.string().nullable(),
    baseContent: z.string(),
    /** null when the turn DELETED the file; such a proposal has no hunks and
     *  is accepted or rejected whole. */
    proposedContent: z.string().nullable(),
    /** `diffLines(baseContent, proposedContent)`, derived server-side so
     *  every surface reviews the same regions. Empty for a deletion. */
    hunks: z.array(proposalHunkSchema),
    /** How many of this suggestion's hunks have reached the file. Counted
     *  rather than inferred — once the list empties, the (base, proposed)
     *  pair looks the same whether the hunks were taken or discarded — and it
     *  is what decides the resolved status. */
    acceptedHunks: z.number().int().min(0),
    createdAt: z.number(),
    updatedAt: z.number(),
    resolvedAt: z.number().nullable(),
  })
  .strict();
export type Proposal = z.infer<typeof proposalSchema>;

export interface ListProposalsResponse {
  proposals: Proposal[];
}

export interface GetProposalResponse {
  proposal: Proposal;
}

/**
 * Narrow to one doc (the editor's gutter) or one thread (the dock); neither
 * answers every pending proposal this vault holds. `includeResolved` is what
 * a caller reading history asks for — the default is the queue.
 */
export const listProposalsQuerySchema = z
  .object({
    docPath: vaultPathSchema.optional(),
    threadId: z.string().min(1).optional(),
    includeResolved: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .strict();
/** What the HANDLER receives — `includeResolved` parsed into a boolean. */
export type ListProposalsQuery = z.infer<typeof listProposalsQuerySchema>;
/** What a CALLER sends. A query string carries text, so the flag is spelled
 *  as one on the wire and the schema above is where it becomes a boolean —
 *  typing the client against the parsed shape would make it send `true` and
 *  the validator refuse the `"true"` that arrived. */
export interface ListProposalsQueryInput {
  docPath?: string;
  threadId?: string;
  includeResolved?: "true" | "false";
}

export const proposalIdQuerySchema = z.object({ proposalId: z.string().min(1) }).strict();
export type ProposalIdQuery = z.infer<typeof proposalIdQuerySchema>;

/** `hunkIndex` omitted means the whole proposal. */
const proposalVerbFields = {
  proposalId: z.string().min(1),
  expectedRevision: z.number().int().min(1),
  hunkIndex: z.number().int().min(0).optional(),
};

export const acceptProposalRequestSchema = z.object(proposalVerbFields).strict();
export type AcceptProposalRequest = z.infer<typeof acceptProposalRequestSchema>;

export const rejectProposalRequestSchema = z.object(proposalVerbFields).strict();
export type RejectProposalRequest = z.infer<typeof rejectProposalRequestSchema>;

export interface ResolveProposalResponse {
  /** The proposal AFTER the verb: still pending with fewer hunks, or resolved. */
  proposal: Proposal;
}

export const proposalRoutes = {
  list: defineRoute({
    path: "/proposals/list",
    method: "get",
    request: optionalQueryRequest<
      EmptyInput,
      ListProposalsQueryInput,
      typeof listProposalsQuerySchema
    >(listProposalsQuerySchema),
    response: [
      jsonResponse<ListProposalsResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
    ] as const,
  }),
  get: defineRoute({
    path: "/proposals/get",
    method: "get",
    request: queryRequest<EmptyInput, ProposalIdQuery>(proposalIdQuerySchema),
    response: [
      jsonResponse<GetProposalResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
    ] as const,
  }),
  accept: defineRoute({
    path: "/proposals/accept",
    method: "post",
    request: jsonRequest<EmptyInput, AcceptProposalRequest>(acceptProposalRequestSchema),
    response: [
      jsonResponse<ResolveProposalResponse>(),
      // A hunk index outside the derived list.
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
      // `conflict` — the revision moved; `cas_mismatch` — the FILE moved, so
      // the base these hunks were computed against is no longer on disk.
      jsonResponse<ApiErrorResponse>({ status: 409 }),
    ] as const,
  }),
  reject: defineRoute({
    path: "/proposals/reject",
    method: "post",
    request: jsonRequest<EmptyInput, RejectProposalRequest>(rejectProposalRequestSchema),
    response: [
      jsonResponse<ResolveProposalResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
      jsonResponse<ApiErrorResponse>({ status: 409 }),
    ] as const,
  }),
};
