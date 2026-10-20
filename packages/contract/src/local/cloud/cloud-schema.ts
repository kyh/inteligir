// the credential never crosses this wire; deviceId is the only identity a client is shown.
// no separate "sync enabled" flag beside the credential: two values that must agree can disagree.

import { deviceSignUpRequestSchema } from "@repo/contract/cloud/account/account-schema";
import { deviceLoginRequestSchema } from "@repo/contract/cloud/device/device-schema";
import { z } from "zod";

export { deleteAccountRequestSchema as cloudDeleteAccountRequestSchema } from "@repo/contract/cloud/account/account-schema";
export {
  PASSWORD_MAX_LENGTH as CLOUD_PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH as CLOUD_PASSWORD_MIN_LENGTH,
  revokeDeviceRequestSchema as cloudRevokeDeviceRequestSchema,
} from "@repo/contract/cloud/device/device-schema";

export const cloudStatusResponseSchema = z.discriminatedUnion("state", [
  z.strictObject({
    cloudUrl: z.url(),
    // the last sign-out's revoke, refused or unreachable: the credential is gone here and still
    // live in the cloud until another device revokes it
    revokeError: z.string().nullable(),
    state: z.literal("signed-out"),
  }),
  z.strictObject({
    accountEmail: z.string().min(1),
    cloudUrl: z.url(),
    // the account socket is up, so another device's change to the hosted vault reaches this one
    // at once; without it the vault's own timer still pulls
    connected: z.boolean(),
    deviceId: z.string().min(1),
    // the last check of the sign-in that met no verdict on it (the cloud unreachable), cleared by
    // the next that reaches it
    lastError: z.string().nullable(),
    state: z.literal("signed-in"),
  }),
  // distinct from signed-out: the fix is a sign-in, which replaces the refused credential. no
  // timer or socket runs here either
  z.strictObject({
    cloudUrl: z.url(),
    detail: z.string().min(1),
    deviceId: z.string().min(1),
    state: z.literal("unauthorized"),
  }),
  // the cloud refused this build, not the credential: the fix is an update, which signs in as the
  // same device. nothing runs here either
  z.strictObject({
    cloudUrl: z.url(),
    deviceId: z.string().min(1),
    state: z.literal("outdated"),
  }),
]);
export type CloudStatusResponse = z.infer<typeof cloudStatusResponseSchema>;

// the account's devices still signed in; `current` is this one, which signs out rather than
// being revoked from here
export const cloudDeviceSchema = z.strictObject({
  createdAt: z.number().int(),
  current: z.boolean(),
  id: z.string().min(1),
  lastSeenAt: z.number().int().nullable(),
  name: z.string(),
});
export type CloudDevice = z.infer<typeof cloudDeviceSchema>;

export const cloudDevicesResponseSchema = z.strictObject({ devices: z.array(cloudDeviceSchema) });
export type CloudDevicesResponse = z.infer<typeof cloudDevicesResponseSchema>;

export const cloudRevokeDeviceResponseSchema = z.strictObject({ revoked: z.literal(true) });
export type CloudRevokeDeviceResponse = z.infer<typeof cloudRevokeDeviceResponseSchema>;

// where a person removes a device this one could not: the Worker's devices page
// (apps/web/src/routes/app/devices.tsx), named once for the two clients that point at it
export const cloudDevicesPageUrl = (cloudUrl: string): string =>
  new URL("/app/devices", cloudUrl).href;

// where a forgotten password is reset: the Worker's page that mails the link
// (apps/web/src/routes/app/forgot-password.tsx)
export const cloudForgotPasswordPageUrl = (cloudUrl: string): string =>
  new URL("/app/forgot-password", cloudUrl).href;

// absent means the server's own hostname. imported, not restated: a name accepted here and refused at
// login is a shape error long after the click
const localDeviceNameSchema = deviceLoginRequestSchema.shape.deviceName.optional();

// the cloud's own email and password fields, so a value refused there is refused here first
export const cloudLoginRequestSchema = deviceLoginRequestSchema
  .pick({ email: true, password: true })
  .extend({ deviceName: localDeviceNameSchema });
export type CloudLoginRequest = z.infer<typeof cloudLoginRequestSchema>;

export const cloudSignUpRequestSchema = deviceSignUpRequestSchema
  .pick({ email: true, inviteCode: true, name: true, password: true })
  .extend({ deviceName: localDeviceNameSchema });
export type CloudSignUpRequest = z.infer<typeof cloudSignUpRequestSchema>;
