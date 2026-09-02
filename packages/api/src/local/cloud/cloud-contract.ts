import { oc } from "@orpc/contract";
import {
  cloudPairBeginRequestSchema,
  cloudPairBeginResponseSchema,
  cloudStatusResponseSchema,
} from "./cloud-schema";

export const cloudContract = {
  status: oc.output(cloudStatusResponseSchema),

  // no procedure takes a code: only a browser arriving at GET /pair/callback with a state
  // this handed out completes a pairing. BAD_REQUEST: the call did not arrive over this
  // server's own loopback origin, so it names no callback address
  pairBegin: oc
    .input(cloudPairBeginRequestSchema)
    .output(cloudPairBeginResponseSchema)
    .errors({ BAD_REQUEST: {} }),

  // only forgets the credential; the device row on the account survives until revoked there
  unpair: oc.output(cloudStatusResponseSchema),

  // a refusal along the way is reported in lastError, never raised
  syncNow: oc.output(cloudStatusResponseSchema),
};
