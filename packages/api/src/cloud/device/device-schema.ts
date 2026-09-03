import { z } from "zod";
import type { CloudErrorCode } from "../cloud-errors";

export const DEVICE_API_PATHS = {
  login: "/v1/device/login",
  list: "/v1/device/list",
  revoke: "/v1/device/revoke",
} as const;

// the prefix routes a bearer to the device table without asking better auth, so a session
// token and a device credential cannot shadow each other
export const DEVICE_CREDENTIAL_PREFIX = "igd_";
export const DEVICE_CREDENTIAL_PATTERN = /^igd_[0-9a-f]{64}$/;

// exported: the local app's own route bounds the same field, and a hand-copied number passes
// locally but is refused here as a shape error
export const DEVICE_NAME_MAX_LENGTH = 64;

// a raw hostname can be empty or over the cloud's ceiling, refused steps later as a shape error
export function normalizeDeviceName(raw: string): string {
  const name = raw.trim().slice(0, DEVICE_NAME_MAX_LENGTH);
  return name.length === 0 ? "this device" : name;
}

// better auth's own bounds: a password refused here is one it would refuse too, and a longer
// one is hashing cost an unauthenticated caller chooses
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

// the email is folded the way better auth stores it, so a caller's capitals never miss the account
export const deviceLoginRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
    deviceName: z.string().trim().min(1).max(DEVICE_NAME_MAX_LENGTH),
  })
  .strict();
export type DeviceLoginRequest = z.infer<typeof deviceLoginRequestSchema>;

// what the login route answers besides bad-request; a client switches on these and nothing else
export const DEVICE_LOGIN_REFUSALS = [
  "invalid-credentials",
  "device-limit",
  "rate-limited",
] as const satisfies readonly CloudErrorCode[];
export type DeviceLoginRefusal = (typeof DEVICE_LOGIN_REFUSALS)[number];

export function isDeviceLoginRefusal(code: CloudErrorCode): code is DeviceLoginRefusal {
  return DEVICE_LOGIN_REFUSALS.some((refusal) => refusal === code);
}

// the credential at rest is parsed on every read: a malformed record must read as
// "signed out", never as a credential the cloud refuses on every request forever
const deviceCredentialFields = {
  deviceId: z.string().min(1),
  credential: z.string().regex(DEVICE_CREDENTIAL_PATTERN),
};
export const deviceCredentialSchema = z.object(deviceCredentialFields).strict();
export type DeviceCredential = z.infer<typeof deviceCredentialSchema>;

export const deviceLoginResponseSchema = z.object(deviceCredentialFields).strict();
export type DeviceLoginResponse = z.infer<typeof deviceLoginResponseSchema>;

export const deviceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    createdAt: z.number().int(),
    lastSeenAt: z.number().int().nullable(),
    revokedAt: z.number().int().nullable(),
  })
  .strict();
export type Device = z.infer<typeof deviceSchema>;

export const listDevicesResponseSchema = z
  .object({
    devices: z.array(deviceSchema),
  })
  .strict();
export type ListDevicesResponse = z.infer<typeof listDevicesResponseSchema>;

export const revokeDeviceRequestSchema = z
  .object({
    deviceId: z.string().min(1),
  })
  .strict();
export type RevokeDeviceRequest = z.infer<typeof revokeDeviceRequestSchema>;

export const revokeDeviceResponseSchema = z
  .object({
    revoked: z.literal(true),
  })
  .strict();
export type RevokeDeviceResponse = z.infer<typeof revokeDeviceResponseSchema>;
