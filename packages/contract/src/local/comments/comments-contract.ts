// every row answers the fresh folded listing, not a delta: `anchored` derives from the note's
// current markers, which a caller holding a stale fold cannot recompute

import { oc } from "@orpc/contract";

import { INVALID_PATH, VAULT_REFUSAL_ERRORS } from "../local-errors";
import {
  commentsAddRequestSchema,
  commentsListRequestSchema,
  commentsRemoveRequestSchema,
  commentsRemoveResponseSchema,
  commentsReplyRequestSchema,
  commentsResolveRequestSchema,
  commentsResponseSchema,
} from "./comments-schema";

export const commentsContract = {
  add: oc
    .input(commentsAddRequestSchema)
    .output(commentsResponseSchema)
    .errors({ ...VAULT_REFUSAL_ERRORS, BAD_REQUEST: {} }),

  // a list against a missing note still answers its sidecar, so no NOT_FOUND here. BAD_REQUEST:
  // folding a legacy sidecar mints an id, refused when the note's `id` is not text
  list: oc
    .input(commentsListRequestSchema)
    .output(commentsResponseSchema)
    .errors({ BAD_REQUEST: {}, CONFLICT: {}, INVALID_PATH, PAYLOAD_TOO_LARGE: {} }),

  remove: oc
    .input(commentsRemoveRequestSchema)
    .output(commentsRemoveResponseSchema)
    .errors({ ...VAULT_REFUSAL_ERRORS, BAD_REQUEST: {} }),

  reply: oc
    .input(commentsReplyRequestSchema)
    .output(commentsResponseSchema)
    .errors({ ...VAULT_REFUSAL_ERRORS, BAD_REQUEST: {} }),

  resolve: oc
    .input(commentsResolveRequestSchema)
    .output(commentsResponseSchema)
    .errors({ ...VAULT_REFUSAL_ERRORS, BAD_REQUEST: {} }),
};
