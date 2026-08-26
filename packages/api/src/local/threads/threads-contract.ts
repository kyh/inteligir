// The thread surface's procedures. One row per operation, each naming its
// input, its output and the classes it can refuse with.

import { oc } from "@orpc/contract";
import {
  ALREADY_RESOLVED,
  ARCHIVED,
  DISPATCH_FAILED,
  INVALID_RESOLUTION,
  NOT_STEERABLE,
  PROVIDER_UNAVAILABLE,
  STALE_TURN,
} from "../local-errors";
import {
  answerInteractionRequestSchema,
  answerInteractionResponseSchema,
  archiveThreadRequestSchema,
  createThreadRequestSchema,
  getThreadResponseSchema,
  listInteractionsQuerySchema,
  listInteractionsResponseSchema,
  listThreadsResponseSchema,
  sendMessageRequestSchema,
  sendMessageResponseSchema,
  threadIdQuerySchema,
  threadResponseSchema,
  timelineQuerySchema,
  timelineResponseSchema,
} from "./threads-schema";

export const threadsContract = {
  list: oc.output(listThreadsResponseSchema),

  get: oc.input(threadIdQuerySchema).output(getThreadResponseSchema).errors({ NOT_FOUND: {} }),

  create: oc.input(createThreadRequestSchema).output(threadResponseSchema),

  archive: oc
    .input(archiveThreadRequestSchema)
    .output(threadResponseSchema)
    .errors({ NOT_FOUND: {} }),

  send: oc.input(sendMessageRequestSchema).output(sendMessageResponseSchema).errors({
    NOT_FOUND: {},
    ARCHIVED,
    STALE_TURN,
    NOT_STEERABLE,
    PROVIDER_UNAVAILABLE,
    DISPATCH_FAILED,
  }),

  timeline: oc.input(timelineQuerySchema).output(timelineResponseSchema).errors({ NOT_FOUND: {} }),

  listInteractions: oc.input(listInteractionsQuerySchema).output(listInteractionsResponseSchema),

  answerInteraction: oc
    .input(answerInteractionRequestSchema)
    .output(answerInteractionResponseSchema)
    .errors({ NOT_FOUND: {}, ALREADY_RESOLVED, INVALID_RESOLUTION }),
};
