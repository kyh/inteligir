import { oc } from "@orpc/contract";
import { PROVIDER_UNAVAILABLE } from "../local-errors";
import { cloudLoginRequestSchema, cloudStatusResponseSchema } from "./cloud-schema";

export const cloudContract = {
  // the account's own refusals, each its own class so a client can say which: UNAUTHORIZED is a
  // wrong email or password, CONFLICT the account's device cap, TOO_MANY_REQUESTS the login
  // window, and PROVIDER_UNAVAILABLE a cloud that did not answer or answered nothing this build reads
  login: oc
    .input(cloudLoginRequestSchema)
    .output(cloudStatusResponseSchema)
    .errors({ CONFLICT: {}, PROVIDER_UNAVAILABLE, TOO_MANY_REQUESTS: {}, UNAUTHORIZED: {} }),

  // only forgets the credential; the device row on the account survives until revoked there
  logout: oc.output(cloudStatusResponseSchema),

  status: oc.output(cloudStatusResponseSchema),

  // a refusal along the way is reported in lastError, never raised
  syncNow: oc.output(cloudStatusResponseSchema),
};
