// the credential never crosses this wire; deviceId is the only identity a client is shown.
// no separate "sync enabled" flag beside the credential: two values that must agree can disagree.

import { deviceSignUpRequestSchema } from "@repo/api/cloud/account/account-schema";
import {
  DEVICE_NAME_MAX_LENGTH,
  deviceLoginRequestSchema,
} from "@repo/api/cloud/device/device-schema";
import { z } from "zod";

// imported, not restated: a name accepted here and refused at login is a shape error long after the click
export const CLOUD_DEVICE_NAME_MAX_LENGTH = DEVICE_NAME_MAX_LENGTH;
export { deleteAccountRequestSchema as cloudDeleteAccountRequestSchema } from "@repo/api/cloud/account/account-schema";
export {
  PASSWORD_MAX_LENGTH as CLOUD_PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH as CLOUD_PASSWORD_MIN_LENGTH,
  revokeDeviceRequestSchema as cloudRevokeDeviceRequestSchema,
} from "@repo/api/cloud/device/device-schema";

export const cloudStatusResponseSchema = z.discriminatedUnion("state", [
  z
    .object({
      cloudUrl: z.url(),
      // the last sign-out's revoke, refused or unreachable: the credential is gone here and still
      // live in the cloud until another device revokes it
      revokeError: z.string().nullable(),
      state: z.literal("signed-out"),
    })
    .strict(),
  z
    .object({
      // null until the best-effort fetch lands, or against a stale cloud with no account route
      accountEmail: z.string().nullable(),
      cloudUrl: z.url(),
      // latency, not correctness: the timer still pulls without the socket
      connected: z.boolean(),
      cursor: z.number().int().nonnegative(),
      deviceId: z.string().min(1),
      // queued events deleted without reaching the log, since this sign-in; lastError says the
      // latest refusal, and the next good pass clears it
      dropped: z.number().int().nonnegative(),
      lastError: z.string().nullable(),
      lastSyncedAt: z.number().int().nullable(),
      pending: z.number().int().nonnegative(),
      state: z.literal("signed-in"),
    })
    .strict(),
  // distinct from signed-out: the fix is a sign-in, which replaces the refused credential. no
  // timer or socket runs here either
  z
    .object({
      cloudUrl: z.url(),
      detail: z.string().min(1),
      deviceId: z.string().min(1),
      state: z.literal("unauthorized"),
    })
    .strict(),
]);
export type CloudStatusResponse = z.infer<typeof cloudStatusResponseSchema>;

// the account's devices still signed in; `current` is this one, which signs out rather than
// being revoked from here, since a sign-out also clears what it has queued
export const cloudDeviceSchema = z
  .object({
    createdAt: z.number().int(),
    current: z.boolean(),
    id: z.string().min(1),
    lastSeenAt: z.number().int().nullable(),
    name: z.string(),
  })
  .strict();
export type CloudDevice = z.infer<typeof cloudDeviceSchema>;

export const cloudDevicesResponseSchema = z
  .object({ devices: z.array(cloudDeviceSchema) })
  .strict();
export type CloudDevicesResponse = z.infer<typeof cloudDevicesResponseSchema>;

export const cloudRevokeDeviceResponseSchema = z.object({ revoked: z.literal(true) }).strict();
export type CloudRevokeDeviceResponse = z.infer<typeof cloudRevokeDeviceResponseSchema>;

// where a person removes a device this one could not: the Worker's devices page
// (apps/web/src/routes/app/devices.tsx), named once for the two clients that point at it
export const cloudDevicesPageUrl = (cloudUrl: string): string =>
  new URL("/app/devices", cloudUrl).href;

// where a forgotten password is reset: the Worker's page that mails the link
// (apps/web/src/routes/app/forgot-password.tsx)
export const cloudForgotPasswordPageUrl = (cloudUrl: string): string =>
  new URL("/app/forgot-password", cloudUrl).href;

// what this Mac lets the account's other devices ask of it, stored in its own data dir.
// phoneRequests: whether it takes a phone's requests to run the agent; on as it ships.
export const cloudPrefsSchema = z.object({ phoneRequests: z.boolean() }).strict();
export type CloudPrefs = z.infer<typeof cloudPrefsSchema>;

// absent means the server's own hostname
const localDeviceNameSchema = z.string().trim().min(1).max(CLOUD_DEVICE_NAME_MAX_LENGTH).optional();

// the cloud's own email and password fields, so a value refused there is refused here first
export const cloudLoginRequestSchema = deviceLoginRequestSchema
  .pick({ email: true, password: true })
  .extend({ deviceName: localDeviceNameSchema })
  .strict();
export type CloudLoginRequest = z.infer<typeof cloudLoginRequestSchema>;

export const cloudSignUpRequestSchema = deviceSignUpRequestSchema
  .pick({ email: true, inviteCode: true, name: true, password: true })
  .extend({ deviceName: localDeviceNameSchema })
  .strict();
export type CloudSignUpRequest = z.infer<typeof cloudSignUpRequestSchema>;
