// The thread surface's procedures. One row per operation, each naming its
// input, its output and the classes it can refuse with.

import { oc } from "@orpc/contract";
import {
  ALREADY_RESOLVED,
  ARCHIVED,
  DISPATCH_FAILED,
  INVALID_RESOLUTION,
  PROVIDER_UNAVAILABLE,
  STALE_TURN,
} from "../local-errors";
import {
  answerInteractionRequestSchema,
  answerInteractionResponseSchema,
  archiveThreadRequestSchema,
  createThreadRequestSchema,
  getThreadResponseSchema,
  interruptThreadRequestSchema,
  interruptThreadResponseSchema,
  listInteractionsQuerySchema,
  listInteractionsResponseSchema,
  listThreadsQuerySchema,
  listThreadsResponseSchema,
  sendMessageRequestSchema,
  sendMessageResponseSchema,
  threadIdQuerySchema,
  threadResponseSchema,
  timelineQuerySchema,
  timelineResponseSchema,
} from "./threads-schema";

export const threadsContract = {
  answerInteraction: oc
    .input(answerInteractionRequestSchema)
    .output(answerInteractionResponseSchema)
    .errors({ ALREADY_RESOLVED, INVALID_RESOLUTION, NOT_FOUND: {} }),

  archive: oc
    .input(archiveThreadRequestSchema)
    .output(threadResponseSchema)
    .errors({ NOT_FOUND: {} }),

  create: oc.input(createThreadRequestSchema).output(threadResponseSchema),

  get: oc.input(threadIdQuerySchema).output(getThreadResponseSchema).errors({ NOT_FOUND: {} }),

  // CONFLICT: the running turn belongs to another device, whose provider nothing here can reach.
  interrupt: oc
    .input(interruptThreadRequestSchema)
    .output(interruptThreadResponseSchema)
    .errors({ CONFLICT: {}, NOT_FOUND: {} }),

  list: oc.input(listThreadsQuerySchema).output(listThreadsResponseSchema),

  listInteractions: oc.input(listInteractionsQuerySchema).output(listInteractionsResponseSchema),

  send: oc.input(sendMessageRequestSchema).output(sendMessageResponseSchema).errors({
    ARCHIVED,
    DISPATCH_FAILED,
    NOT_FOUND: {},
    PROVIDER_UNAVAILABLE,
    STALE_TURN,
  }),

  timeline: oc.input(timelineQuerySchema).output(timelineResponseSchema).errors({ NOT_FOUND: {} }),
};
