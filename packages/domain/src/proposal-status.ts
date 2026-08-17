// A suggested edit's lifecycle.
//
// THREE of these are stored and the fourth is DERIVED, which is the whole
// shape of the vocabulary: a proposal is stale when the bytes it was computed
// against are no longer the bytes on disk, and disk is not something a row can
// know. Storing `stale` would need a writer watching every file, and the value
// would be wrong the instant the watcher was late — so the store writes
// `pending` and every reader that has the file in hand refines it.
//
// The wire vocabulary is DERIVED from the stored one rather than written
// beside it, so the two cannot fall out of step.

import { z } from "zod";

export const STORED_PROPOSAL_STATUS_VALUES = ["pending", "accepted", "rejected"] as const;
export const storedProposalStatusSchema = z.enum(STORED_PROPOSAL_STATUS_VALUES);
export type StoredProposalStatus = z.infer<typeof storedProposalStatusSchema>;

export const PROPOSAL_STATUS_VALUES = [...STORED_PROPOSAL_STATUS_VALUES, "stale"] as const;
export const proposalStatusSchema = z.enum(PROPOSAL_STATUS_VALUES);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;
