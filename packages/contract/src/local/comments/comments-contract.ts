// every row answers the fresh folded listing, not a delta: `anchored` derives from the note's
// current markers, which a caller holding a stale fold cannot recompute

import { oc } from "@orpc/contract";

import { COMMENTS_REFUSAL_ERRORS, INVALID_PATH, VAULT_REFUSAL_ERRORS } from "../local-errors";
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
    .errors({ ...VAULT_REFUSAL_ERRORS, ...COMMENTS_REFUSAL_ERRORS }),

  // a list against a missing note answers empty, so no NOT_FOUND here. BAD_REQUEST: the note's
  // `id` cannot name a store file; CONFLICT: the store it names is not a store
  list: oc
    .input(commentsListRequestSchema)
    .output(commentsResponseSchema)
    .errors({ ...COMMENTS_REFUSAL_ERRORS, INVALID_PATH, PAYLOAD_TOO_LARGE: {} }),

  remove: oc
    .input(commentsRemoveRequestSchema)
    .output(commentsRemoveResponseSchema)
    .errors({ ...VAULT_REFUSAL_ERRORS, ...COMMENTS_REFUSAL_ERRORS }),

  reply: oc
    .input(commentsReplyRequestSchema)
    .output(commentsResponseSchema)
    .errors({ ...VAULT_REFUSAL_ERRORS, ...COMMENTS_REFUSAL_ERRORS }),

  resolve: oc
    .input(commentsResolveRequestSchema)
    .output(commentsResponseSchema)
    .errors({ ...VAULT_REFUSAL_ERRORS, ...COMMENTS_REFUSAL_ERRORS }),
};
