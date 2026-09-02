// every row answers the fresh folded listing, not a delta: `anchored` derives from the note's
// current markers, which a caller holding a stale fold cannot recompute

import { oc } from "@orpc/contract";

import { INVALID_PATH } from "../local-errors";
import {
  commentsAddRequestSchema,
  commentsListRequestSchema,
  commentsRemoveRequestSchema,
  commentsRemoveResponseSchema,
  commentsReplyRequestSchema,
  commentsResolveRequestSchema,
  commentsResponseSchema,
} from "./comments-schema";

// PAYLOAD_TOO_LARGE is reachable: a sidecar past the vault's read cap
const VAULT_REFUSALS = { INVALID_PATH, NOT_FOUND: {}, CONFLICT: {}, PAYLOAD_TOO_LARGE: {} };

export const commentsContract = {
  // a list against a missing note still answers its sidecar, so no NOT_FOUND here
  list: oc
    .input(commentsListRequestSchema)
    .output(commentsResponseSchema)
    .errors({ INVALID_PATH, CONFLICT: {}, PAYLOAD_TOO_LARGE: {} }),

  add: oc
    .input(commentsAddRequestSchema)
    .output(commentsResponseSchema)
    .errors({ ...VAULT_REFUSALS, BAD_REQUEST: {} }),

  reply: oc
    .input(commentsReplyRequestSchema)
    .output(commentsResponseSchema)
    .errors({ ...VAULT_REFUSALS, BAD_REQUEST: {} }),

  resolve: oc
    .input(commentsResolveRequestSchema)
    .output(commentsResponseSchema)
    .errors({ ...VAULT_REFUSALS, BAD_REQUEST: {} }),

  remove: oc
    .input(commentsRemoveRequestSchema)
    .output(commentsRemoveResponseSchema)
    .errors({ ...VAULT_REFUSALS, BAD_REQUEST: {} }),
};
