// GET /voice/stream is a websocket, not a procedure.

import { oc } from "@orpc/contract";
import { PROVIDER_UNAVAILABLE } from "../local-errors";
import {
  voiceStatusResponseSchema,
  voiceTranscribeRequestSchema,
  voiceTranscribeResponseSchema,
} from "./voice-schema";

export const voiceContract = {
  status: oc.output(voiceStatusResponseSchema),

  // answers before the bytes land: a ~106 mb fetch outlives any request timeout, so the surface
  // polls `status`.
  install: oc.output(voiceStatusResponseSchema).errors({ CONFLICT: {}, PROVIDER_UNAVAILABLE }),

  // idempotent: "already off" is not a refusal.
  remove: oc.output(voiceStatusResponseSchema),

  // a loaded runtime that refuses the clip answers PROVIDER_UNAVAILABLE too; the message tells
  // them apart.
  transcribe: oc
    .input(voiceTranscribeRequestSchema)
    .output(voiceTranscribeResponseSchema)
    .errors({ BAD_REQUEST: {}, CONFLICT: {}, PROVIDER_UNAVAILABLE }),
};
