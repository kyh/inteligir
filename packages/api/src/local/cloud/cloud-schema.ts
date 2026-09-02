// the credential never crosses this wire; deviceId is the only identity a client is shown.
// no separate "sync enabled" flag beside the credential: two values that must agree can disagree.

import { DEVICE_NAME_MAX_LENGTH } from "@repo/api/cloud/pairing/pairing-schema";
import { z } from "zod";

// imported, not restated: a name accepted here and refused at redeem is a shape error long after the click
export const CLOUD_DEVICE_NAME_MAX_LENGTH = DEVICE_NAME_MAX_LENGTH;

export const cloudStatusResponseSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("off"),
      cloudUrl: z.url(),
    })
    .strict(),
  z
    .object({
      state: z.literal("paired"),
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
  // distinct from off: the fix is unpair and pair again. no timer or socket runs here either
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

export const cloudPairBeginRequestSchema = z
  .object({
    // absent means the server's own hostname
    deviceName: z.string().trim().min(1).max(CLOUD_DEVICE_NAME_MAX_LENGTH).optional(),
    // required, not defaulted: the caller that must say false is an agent shell, which a default lets forget
    openBrowser: z.boolean(),
  })
  .strict();
export type CloudPairBeginRequest = z.infer<typeof cloudPairBeginRequestSchema>;

export const cloudPairBeginResponseSchema = z
  .object({
    url: z.url(),
    // false is not a failure: it is also what openBrowser: false asks for
    opened: z.boolean(),
    deviceName: z.string().min(1),
    expiresInMs: z.number().int().positive(),
  })
  .strict();
export type CloudPairBeginResponse = z.infer<typeof cloudPairBeginResponseSchema>;
