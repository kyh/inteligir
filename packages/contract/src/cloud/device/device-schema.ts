// What `account.*` (`../account/account-contract.ts`) reads and answers about a device: the
// sign-in that mints its credential, the credential's shape at rest, and the account's devices.

import { z } from "zod";

// a bearer without the prefix is refused before its hash and the D1 read; the Authorization
// header, not the prefix, is what says a request's credential is a device's
export const DEVICE_CREDENTIAL_PREFIX = "igd_";
export const DEVICE_CREDENTIAL_PATTERN = /^igd_[0-9a-f]{64}$/u;

/** @internal */
export const DEVICE_NAME_MAX_LENGTH = 64;

// a raw hostname can be empty or over the cloud's ceiling, refused steps later as a shape error
export const normalizeDeviceName = (raw: string): string => {
  const name = raw.trim().slice(0, DEVICE_NAME_MAX_LENGTH);
  return name.length === 0 ? "this device" : name;
};

// the Worker configures Better Auth with these, so a password refused here is one it would
// refuse too; the ceiling is there because a longer one is hashing cost an unauthenticated
// caller chooses
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

// the email is folded the way better auth stores it, so a caller's capitals never miss the account
export const deviceLoginRequestSchema = z.strictObject({
  deviceName: z.string().trim().min(1).max(DEVICE_NAME_MAX_LENGTH),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

// the credential at rest is parsed on every read: a malformed record must read as
// "signed out", never as a credential the cloud refuses on every request forever
const deviceCredentialFields = {
  credential: z.string().regex(DEVICE_CREDENTIAL_PATTERN),
  deviceId: z.string().min(1),
};
export const deviceCredentialSchema = z.strictObject(deviceCredentialFields);

// the account rides the answer that mints the credential, so a client knows whose library it opens
// from its first request on, and each device keeps the account's name beside the bearer
export const deviceLoginResponseSchema = z.object({
  ...deviceCredentialFields,
  email: z.string().min(1),
  userId: z.string().min(1),
});
export type DeviceLoginResponse = z.infer<typeof deviceLoginResponseSchema>;

const deviceSchema = z.object({
  createdAt: z.number().int(),
  // this is the device asking; a browser's session is no device, so it finds none
  current: z.boolean(),
  id: z.string().min(1),
  lastSeenAt: z.number().int().nullable(),
  name: z.string(),
  revokedAt: z.number().int().nullable(),
});
export type Device = z.infer<typeof deviceSchema>;

export const listDevicesResponseSchema = z.object({
  devices: z.array(deviceSchema),
});
export type ListDevicesResponse = z.infer<typeof listDevicesResponseSchema>;

export const revokeDeviceRequestSchema = z.strictObject({
  deviceId: z.string().min(1),
});

// also the sign-out's answer: that row is this revoke with the credential naming the device
export const revokeDeviceResponseSchema = z.object({
  revoked: z.literal(true),
});
