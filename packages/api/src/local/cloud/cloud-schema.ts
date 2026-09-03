// the credential never crosses this wire; deviceId is the only identity a client is shown.
// no separate "sync enabled" flag beside the credential: two values that must agree can disagree.

import {
  DEVICE_NAME_MAX_LENGTH,
  deviceLoginRequestSchema,
} from "@repo/api/cloud/device/device-schema";
import { z } from "zod";

// imported, not restated: a name accepted here and refused at login is a shape error long after the click
export const CLOUD_DEVICE_NAME_MAX_LENGTH = DEVICE_NAME_MAX_LENGTH;

export const cloudStatusResponseSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("signed-out"),
      cloudUrl: z.url(),
    })
    .strict(),
  z
    .object({
      state: z.literal("signed-in"),
      cloudUrl: z.url(),
      // null until the best-effort fetch lands, or against a stale cloud with no account route
      accountEmail: z.string().nullable(),
      deviceId: z.string().min(1),
      // latency, not correctness: the timer still pulls without the socket
      connected: z.boolean(),
      pending: z.number().int().nonnegative(),
      cursor: z.number().int().nonnegative(),
      lastSyncedAt: z.number().int().nullable(),
      lastError: z.string().nullable(),
    })
    .strict(),
  // distinct from signed-out: the fix is sign out and sign in again. no timer or socket runs here either
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

// the cloud's own email and password fields, so a value refused there is refused here first
export const cloudLoginRequestSchema = deviceLoginRequestSchema
  .pick({ email: true, password: true })
  .extend({
    // absent means the server's own hostname
    deviceName: z.string().trim().min(1).max(CLOUD_DEVICE_NAME_MAX_LENGTH).optional(),
  })
  .strict();
export type CloudLoginRequest = z.infer<typeof cloudLoginRequestSchema>;
