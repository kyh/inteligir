import { oc } from "@orpc/contract";
import { PROVIDER_UNAVAILABLE } from "../local-errors";
import {
  cloudDevicesResponseSchema,
  cloudLoginRequestSchema,
  cloudPrefsSchema,
  cloudRevokeDeviceRequestSchema,
  cloudRevokeDeviceResponseSchema,
  cloudSignUpRequestSchema,
  cloudStatusResponseSchema,
} from "./cloud-schema";

export const cloudContract = {
  // asked with this device's own credential. PRECONDITION_FAILED is no live sign-in to ask with, a
  // credential the cloud refuses included, which also moves the status to unauthorized;
  // PROVIDER_UNAVAILABLE a cloud that did not answer or answered nothing this build reads
  devices: oc
    .output(cloudDevicesResponseSchema)
    .errors({ PRECONDITION_FAILED: {}, PROVIDER_UNAVAILABLE }),

  // the account's own refusals, each its own class so a client can say which: UNAUTHORIZED is a
  // wrong email or password, CONFLICT the account's device cap, TOO_MANY_REQUESTS the login
  // window, and PROVIDER_UNAVAILABLE a cloud that did not answer or answered nothing this build reads
  login: oc
    .input(cloudLoginRequestSchema)
    .output(cloudStatusResponseSchema)
    .errors({ CONFLICT: {}, PROVIDER_UNAVAILABLE, TOO_MANY_REQUESTS: {}, UNAUTHORIZED: {} }),

  // only forgets the credential; the device row on the account survives until revoked there
  logout: oc.output(cloudStatusResponseSchema),

  // this Mac's own choices, kept whether or not it is signed in
  prefs: oc.output(cloudPrefsSchema),

  // cuts another device off at its next request. BAD_REQUEST is this device's own id, which signs
  // out instead; NOT_FOUND a device the account no longer has signed in; the rest as devices'
  revokeDevice: oc
    .input(cloudRevokeDeviceRequestSchema)
    .output(cloudRevokeDeviceResponseSchema)
    .errors({ BAD_REQUEST: {}, NOT_FOUND: {}, PRECONDITION_FAILED: {}, PROVIDER_UNAVAILABLE }),

  setPrefs: oc.input(cloudPrefsSchema).output(cloudPrefsSchema),

  // creates the account and signs this device into it in one step: FORBIDDEN is an invite code
  // that will not work, CONFLICT an email that already has an account, TOO_MANY_REQUESTS the
  // invite gate's window, PROVIDER_UNAVAILABLE as login's
  signUp: oc
    .input(cloudSignUpRequestSchema)
    .output(cloudStatusResponseSchema)
    .errors({ CONFLICT: {}, FORBIDDEN: {}, PROVIDER_UNAVAILABLE, TOO_MANY_REQUESTS: {} }),

  status: oc.output(cloudStatusResponseSchema),

  // a refusal along the way is reported in lastError, never raised
  syncNow: oc.output(cloudStatusResponseSchema),
};
