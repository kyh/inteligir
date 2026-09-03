// GET /voice/stream is a websocket, not a procedure.

import { oc } from "@orpc/contract";
import { PROVIDER_UNAVAILABLE } from "../local-errors";
import { voiceStatusResponseSchema } from "./voice-schema";

export const voiceContract = {
  status: oc.output(voiceStatusResponseSchema),

  // answers before the bytes land: a ~106 mb fetch outlives any request timeout, so the surface
  // polls `status`.
  install: oc.output(voiceStatusResponseSchema).errors({ CONFLICT: {}, PROVIDER_UNAVAILABLE }),

  // idempotent: "already off" is not a refusal.
  remove: oc.output(voiceStatusResponseSchema),
};
