// What `account.*` (`../account/account-contract.ts`) reads and answers about a device: the
// password bounds every sign-in and sign-up form keeps, and the account's devices, each one of its
// signed-in sessions.

import { z } from "zod";

// the Worker configures Better Auth with these, so a password refused here is one it would
// refuse too; the ceiling is there because a longer one is hashing cost an unauthenticated
// caller chooses
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

// a session is named from the user agent it signed in with, never by its token
const deviceSchema = z.object({
  createdAt: z.number().int(),
  // the session asking
  current: z.boolean(),
  id: z.string().min(1),
  lastSeenAt: z.number().int(),
  name: z.string(),
});
export type Device = z.infer<typeof deviceSchema>;

export const listDevicesResponseSchema = z.object({
  devices: z.array(deviceSchema),
});

export const revokeDeviceRequestSchema = z.strictObject({ id: z.string().min(1) });

export const revokeDeviceResponseSchema = z.object({
  revoked: z.literal(true),
});
