// The anchored-comments procedures. Every one answers the fresh folded
// listing rather than a delta, because `anchored` is derived from the note's
// current markers and a caller holding a stale fold cannot recompute it.

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

/** Every comments row reaches the vault — the sidecar is a file in it — so
 *  every row can answer whatever the vault refuses a read or a write with.
 *  `PAYLOAD_TOO_LARGE` is here because it is REACHABLE (a sidecar past the
 *  vault's read cap), not because a caller is expected to see it. */
const VAULT_REFUSALS = { INVALID_PATH, NOT_FOUND: {}, CONFLICT: {}, PAYLOAD_TOO_LARGE: {} };

export const commentsContract = {
  /** A list against a missing note still answers its sidecar — a thread can
   *  outlive its note through an external delete — so this row alone cannot
   *  refuse NOT_FOUND. */
  list: oc
    .input(commentsListRequestSchema)
    .output(commentsResponseSchema)
    .errors({ INVALID_PATH, CONFLICT: {}, PAYLOAD_TOO_LARGE: {} }),

  /** BAD_REQUEST is the sidecar refusing the edit — an unknown parent, a
   *  duplicate id — decided after the input parsed. */
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
