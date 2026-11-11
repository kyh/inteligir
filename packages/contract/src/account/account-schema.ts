// What `account.*` (`./account-contract.ts`) reads and answers, and the sign-up form the site and
// the phone post, the invite gate in front of Better Auth's sign-up: the password bounds every
// sign-in and sign-up form keeps, the account's devices, each one of its signed-in sessions, and
// its deletion.

import { z } from "zod";

// the Worker configures Better Auth with these, so a password refused here is one it would
// refuse too; the ceiling is there because a longer one is hashing cost an unauthenticated
// caller chooses
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

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

// asked under a session, which alone would let whoever holds a stolen one end the account: the
// password is asked again
export const deleteAccountRequestSchema = z.strictObject({ password: passwordSchema });

export const deleteAccountResponseSchema = z.object({ deleted: z.literal(true) });

// every sign-up posts to the invite gate, beside Better Auth's own routes, never to Better Auth's
// sign-up itself
export const AUTH_API_PATHS = {
  signUp: "/api/sign-up",
} as const;

// the invite code is the gate's to refuse, so an empty one reads as a code that will not work
export const signUpRequestSchema = z.strictObject({
  email: z.string().trim().min(1),
  inviteCode: z.string().trim(),
  name: z.string().trim().min(1),
  password: passwordSchema,
});
export type SignUpRequest = z.infer<typeof signUpRequestSchema>;
