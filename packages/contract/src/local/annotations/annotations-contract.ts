// every row answers the fresh folded listing, not a delta: `anchored` derives from the note's
// current markers, which a caller holding a stale fold cannot recompute

import { oc } from "@orpc/contract";

import { ANNOTATIONS_REFUSAL_ERRORS, INVALID_PATH, VAULT_REFUSAL_ERRORS } from "../local-errors";
import {
  annotationsAddRequestSchema,
  annotationsEditRequestSchema,
  annotationsListRequestSchema,
  annotationsRemoveRequestSchema,
  annotationsRemoveResponseSchema,
  annotationsReplyRequestSchema,
  annotationsResponseSchema,
} from "./annotations-schema";

const WRITE_ERRORS = { ...VAULT_REFUSAL_ERRORS, ...ANNOTATIONS_REFUSAL_ERRORS };

export const annotationsContract = {
  add: oc.input(annotationsAddRequestSchema).output(annotationsResponseSchema).errors(WRITE_ERRORS),

  // BAD_REQUEST: no entry has that id
  edit: oc
    .input(annotationsEditRequestSchema)
    .output(annotationsResponseSchema)
    .errors(WRITE_ERRORS),

  // a list against a missing note answers empty, so no NOT_FOUND here. BAD_REQUEST: the note's
  // `id` cannot name a store file; CONFLICT: the store it names is not a store
  list: oc
    .input(annotationsListRequestSchema)
    .output(annotationsResponseSchema)
    .errors({ ...ANNOTATIONS_REFUSAL_ERRORS, INVALID_PATH, PAYLOAD_TOO_LARGE: {} }),

  remove: oc
    .input(annotationsRemoveRequestSchema)
    .output(annotationsRemoveResponseSchema)
    .errors(WRITE_ERRORS),

  reply: oc
    .input(annotationsReplyRequestSchema)
    .output(annotationsResponseSchema)
    .errors(WRITE_ERRORS),
};
