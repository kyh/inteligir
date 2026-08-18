// The LOCAL face of cloud sync: what the workspace UI and the CLI need to know
// about this install's relationship with an account, and the three verbs that
// change it.
//
// It is deliberately not a mirror of `@repo/cloud-contract`. That package is
// the wire between this machine and the Worker; this one is the wire between
// the browser tab and the Node process that owns the credential — and the
// credential itself must never cross it. Nothing here carries the bearer, and
// `deviceId` is the only identity a client is shown: it is what the account's
// dashboard lists, so it is what a user needs to recognise this machine among
// their devices and revoke it.
//
// PAIRING IS THE SWITCH. There is no separate "sync enabled" flag, because two
// values that must agree are two values that can disagree: an install with a
// credential and the flag off would keep a live credential nothing uses, and
// the flag on without one would be a promise no loop can keep. So the state is
// a three-way union over the credential this data dir holds.

import { DEVICE_NAME_MAX_LENGTH, PAIRING_CODE_MAX_LENGTH } from "@repo/cloud-contract/pairing";
import type { EmptyInput } from "@repo/typed-routes/endpoint";
import {
  defineRoute,
  jsonRequest,
  jsonResponse,
  noRequest,
} from "@repo/typed-routes/route-descriptor";
import { z } from "zod";
import type { ApiErrorResponse } from "./errors";

/**
 * The cloud's own ceiling, re-exported rather than restated.
 *
 * This route is a PROXY for `POST /v1/device/redeem`, so anything it accepts
 * and the cloud does not is a value the user is told is fine and then sees
 * refused, with a shape error about a code they typed correctly. One spelling,
 * imported — the local surface cannot drift wider than the thing it forwards
 * to.
 */
export const CLOUD_DEVICE_NAME_MAX_LENGTH = DEVICE_NAME_MAX_LENGTH;

export const cloudStatusResponseSchema = z.discriminatedUnion("state", [
  /** No credential in the data dir: no socket, no timer, no request. */
  z
    .object({
      state: z.literal("off"),
      /** Which deployment a pair would dial, so the UI can say where the code
       *  has to come from. */
      cloudUrl: z.url(),
    })
    .strict(),
  z
    .object({
      state: z.literal("paired"),
      cloudUrl: z.url(),
      /** This machine's row in the account's device list. */
      deviceId: z.string().min(1),
      /** Whether the invalidation socket is currently up. A pull still runs on
       *  the timer without it, so this is latency, not correctness. */
      connected: z.boolean(),
      /** Events queued for the log and not yet stored by it. */
      pending: z.number().int().nonnegative(),
      /** The account log's global `seq` this device has applied through. */
      cursor: z.number().int().nonnegative(),
      lastSyncedAt: z.number().int().nullable(),
      /** The last attempt's refusal, in the cloud's own words; null once one
       *  succeeds. Being behind is not an error state — a laptop that is
       *  offline is paired and behind, which is what local-first means. */
      lastError: z.string().nullable(),
    })
    .strict(),
  /**
   * The credential is present and the cloud refuses it — revoked from the
   * dashboard, or the account deleted. Distinct from `off` because the two
   * need different sentences and different buttons: this one is an event that
   * happened TO the user, and the fix is to unpair and pair again rather than
   * to wonder why nothing syncs. No timer and no socket run here either: a
   * credential the server has rejected will be rejected again.
   */
  z
    .object({
      state: z.literal("unauthorized"),
      cloudUrl: z.url(),
      deviceId: z.string().min(1),
      detail: z.string().min(1),
    })
    .strict(),
]);
export type CloudStatusResponse = z.infer<typeof cloudStatusResponseSchema>;

export const cloudPairRequestSchema = z
  .object({
    /** The one-time code from the account's Devices page. Its shape is the
     *  cloud's to judge — this end only refuses an empty one, so a mistyped
     *  code answers the cloud's own "that code isn't valid" rather than a
     *  local guess at the same sentence. */
    code: z.string().trim().min(1).max(PAIRING_CODE_MAX_LENGTH),
    /** How this machine appears in the account's device list. */
    deviceName: z.string().trim().min(1).max(CLOUD_DEVICE_NAME_MAX_LENGTH),
  })
  .strict();
export type CloudPairRequest = z.infer<typeof cloudPairRequestSchema>;

export const cloudRoutes = {
  status: defineRoute({
    path: "/cloud/status",
    method: "get",
    request: noRequest(),
    response: jsonResponse<CloudStatusResponse>(),
  }),
  pair: defineRoute({
    path: "/cloud/pair",
    method: "post",
    request: jsonRequest<EmptyInput, CloudPairRequest>(cloudPairRequestSchema),
    response: [
      jsonResponse<CloudStatusResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
      jsonResponse<ApiErrorResponse>({ status: 409 }),
      jsonResponse<ApiErrorResponse, 503>({ status: 503 }),
    ] as const,
  }),
  /** Idempotent: unpairing an install that was never paired answers `off`.
   *  This end only forgets the credential — the device row on the account
   *  survives until it is revoked there, which is where the audit trail is. */
  unpair: defineRoute({
    path: "/cloud/unpair",
    method: "post",
    request: noRequest(),
    response: jsonResponse<CloudStatusResponse>(),
  }),
  /** Run a full pass now — drain, pull, apply, captures — and answer the state
   *  it left behind. A refusal along the way is reported in `lastError` rather
   *  than as a status: the pass is best-effort by construction, and a caller
   *  that asked for one wants to know where it got to. */
  syncNow: defineRoute({
    path: "/cloud/sync",
    method: "post",
    request: noRequest(),
    response: jsonResponse<CloudStatusResponse>(),
  }),
};
