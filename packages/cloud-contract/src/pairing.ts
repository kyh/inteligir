import { z } from "zod";

// ---------------------------------------------------------------------------
// Device pairing (bb's connect-code pattern, MIT — github.com/get-bb/bb).
//
// The flow: a signed-in dashboard mints a short one-time CODE; the local app
// redeems it once for a durable device CREDENTIAL. The code is human-typable
// and short-lived; the credential is 256-bit, stored server-side only as a
// SHA-256 hash, and presented as `Authorization: Bearer` on every sync call.
// ---------------------------------------------------------------------------

/**
 * Where the pairing surface is served. Beside the schemas rather than in each
 * implementation, because a path IS wire: the Worker routes on it, the
 * dashboard fetches it and the local app dials it, and three private copies of
 * a string are three places a rename can miss.
 */
export const DEVICE_API_PATHS = {
  mintCode: "/v1/device/code",
  redeem: "/v1/device/redeem",
  list: "/v1/device/list",
  revoke: "/v1/device/revoke",
} as const;

export const PAIRING_CODE_TTL_MS = 10 * 60_000;

/** The one purpose today's codes carry; a future flow adds its own value
 * rather than overloading this one. */
export const DEVICE_PAIR_PURPOSE = "device-pair";

/** `XXXX-XXXX` over an alphabet with no 0/O/1/I — 32^8 ≈ 2^40, guessable only
 * past the mint's TTL and the redeem route's rate window together. */
export const PAIRING_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** What a device credential looks like on the wire. The prefix is load-bearing:
 * it lets the Worker route a bearer to the device table without ever asking
 * Better Auth, so a session token and a device credential cannot shadow each
 * other. */
export const DEVICE_CREDENTIAL_PREFIX = "igd_";
export const DEVICE_CREDENTIAL_PATTERN = /^igd_[0-9a-f]{64}$/;

// POST /v1/device/code (session-authed; the dashboard's "Pair a device").
export const mintPairingCodeResponseSchema = z
  .object({
    code: z.string().regex(PAIRING_CODE_PATTERN),
    expiresInMs: z.number().int().positive(),
  })
  .strict();
export type MintPairingCodeResponse = z.infer<typeof mintPairingCodeResponseSchema>;

// POST /v1/device/redeem (the code IS the credential; consumed exactly once).
export const redeemDeviceRequestSchema = z
  .object({
    code: z.string().trim().min(1).max(16),
    deviceName: z.string().trim().min(1).max(64),
  })
  .strict();
export type RedeemDeviceRequest = z.infer<typeof redeemDeviceRequestSchema>;

/** The credential appears here ONCE, in plaintext; the server keeps only its
 * hash. Losing it means revoking the device and pairing again. */
export const redeemDeviceResponseSchema = z
  .object({
    deviceId: z.string().min(1),
    credential: z.string().regex(DEVICE_CREDENTIAL_PATTERN),
  })
  .strict();
export type RedeemDeviceResponse = z.infer<typeof redeemDeviceResponseSchema>;

// GET /v1/device/list (session-authed). Revoked devices stay listed — the
// dashboard is the audit surface, and a row vanishing on revoke would erase
// the evidence the revoke button exists to act on.
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

// POST /v1/device/revoke (session-authed). Revocation bites on the next
// request: the credential check is a per-request hash compare, never cached.
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
