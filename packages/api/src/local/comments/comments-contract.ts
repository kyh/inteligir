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

export const commentsContract = {
  /** A list against a missing note still answers its sidecar — a thread can
   *  outlive its note through an external delete — so this row alone cannot
   *  refuse NOT_FOUND. */
  list: oc
    .input(commentsListRequestSchema)
    .output(commentsResponseSchema)
    .errors({ INVALID_PATH, CONFLICT: {} }),

  /** BAD_REQUEST is the sidecar refusing the edit — an unknown parent, a
   *  duplicate id — decided after the input parsed. */
  add: oc
    .input(commentsAddRequestSchema)
    .output(commentsResponseSchema)
    .errors({ INVALID_PATH, BAD_REQUEST: {}, NOT_FOUND: {}, CONFLICT: {} }),

  reply: oc
    .input(commentsReplyRequestSchema)
    .output(commentsResponseSchema)
    .errors({ INVALID_PATH, BAD_REQUEST: {}, NOT_FOUND: {}, CONFLICT: {} }),

  resolve: oc
    .input(commentsResolveRequestSchema)
    .output(commentsResponseSchema)
    .errors({ INVALID_PATH, BAD_REQUEST: {}, NOT_FOUND: {}, CONFLICT: {} }),

  remove: oc
    .input(commentsRemoveRequestSchema)
    .output(commentsRemoveResponseSchema)
    .errors({ INVALID_PATH, BAD_REQUEST: {}, NOT_FOUND: {}, CONFLICT: {} }),
};
