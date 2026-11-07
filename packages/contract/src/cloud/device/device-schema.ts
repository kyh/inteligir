// What `account.*` (`../account/account-contract.ts`) reads and answers about a device: the
// sign-in that mints its credential, the credential's shape, and the account's devices.

import { z } from "zod";

// the prefix routes a bearer to the device table without asking better auth, so a session
// token and a device credential cannot shadow each other
export const DEVICE_CREDENTIAL_PREFIX = "igd_";
export const DEVICE_CREDENTIAL_PATTERN = /^igd_[0-9a-f]{64}$/u;

// exported: a sign-in screen bounds its field with it, so a name the screen takes is never refused
// here as a shape error
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

// the account rides the answer that mints the credential, so a client knows whose library it opens
// from its first request on, and a device that names the account keeps it beside the bearer
export const deviceLoginResponseSchema = z.object({
  credential: z.string().regex(DEVICE_CREDENTIAL_PATTERN),
  deviceId: z.string().min(1),
  email: z.string().min(1),
  userId: z.string().min(1),
});
export type DeviceLoginResponse = z.infer<typeof deviceLoginResponseSchema>;

const deviceSchema = z.object({
  createdAt: z.number().int(),
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
