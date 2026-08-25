// The voice procedures: the dictation switch (status/install/remove) and the
// whole-clip batch transcribe.
//
// `GET /voice/stream` is deliberately NOT here, and the reason is in
// `voice-schema`: a websocket is neither a request/response pair nor something
// a typed client can reach.

import { oc } from "@orpc/contract";
import { PROVIDER_UNAVAILABLE } from "../local-errors";
import {
  voiceStatusResponseSchema,
  voiceTranscribeRequestSchema,
  voiceTranscribeResponseSchema,
} from "./voice-schema";

export const voiceContract = {
  status: oc.output(voiceStatusResponseSchema),

  /**
   * Start the download and answer the status it moved to. It does NOT wait for
   * the bytes: a ~106 MB fetch outlives any request timeout worth having, so the
   * surface polls `status` for `receivedBytes` while it runs.
   */
  install: oc.output(voiceStatusResponseSchema).errors({ CONFLICT: {}, PROVIDER_UNAVAILABLE }),

  /** Turn dictation off: cancel any download, delete the model, answer the
   *  status. Idempotent — this is a switch, so "already off" is not a
   *  refusal. */
  remove: oc.output(voiceStatusResponseSchema),

  /** A runtime that loaded and then refused the clip answers the same
   *  `PROVIDER_UNAVAILABLE` as one that never loaded: from the caller's side it
   *  is the same unusable capability, and the message tells them apart. */
  transcribe: oc
    .input(voiceTranscribeRequestSchema)
    .output(voiceTranscribeResponseSchema)
    .errors({ BAD_REQUEST: {}, CONFLICT: {}, PROVIDER_UNAVAILABLE }),
};
