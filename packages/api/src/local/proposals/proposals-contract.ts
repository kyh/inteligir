// The suggested-edit procedures: read the review queue, read one, and the two
// verbs that resolve one.
//
// `accept` and `reject` answer the SAME outcomes, so they declare the same
// classes — two lists that could drift is how one verb ends up calling a stale
// revision a conflict and the other a bad request. `BAD_REQUEST` is a hunk
// index outside the derived list. `CONFLICT` is the REVISION
// moving; `CAS_MISMATCH` is the FILE moving, so the base these hunks were
// computed against is no longer on disk.

import { oc } from "@orpc/contract";
import { CAS_MISMATCH } from "../local-errors";
import {
  acceptProposalRequestSchema,
  getProposalResponseSchema,
  listProposalsQuerySchema,
  listProposalsResponseSchema,
  proposalIdQuerySchema,
  rejectProposalRequestSchema,
  resolveProposalResponseSchema,
} from "./proposals-schema";

export const proposalsContract = {
  list: oc.input(listProposalsQuerySchema).output(listProposalsResponseSchema),

  get: oc.input(proposalIdQuerySchema).output(getProposalResponseSchema).errors({ NOT_FOUND: {} }),

  accept: oc
    .input(acceptProposalRequestSchema)
    .output(resolveProposalResponseSchema)
    .errors({ BAD_REQUEST: {}, CAS_MISMATCH, NOT_FOUND: {}, CONFLICT: {} }),

  reject: oc
    .input(rejectProposalRequestSchema)
    .output(resolveProposalResponseSchema)
    .errors({ BAD_REQUEST: {}, CAS_MISMATCH, NOT_FOUND: {}, CONFLICT: {} }),
};
