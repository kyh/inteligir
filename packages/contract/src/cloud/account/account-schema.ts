// What `account.delete` reads to end an account, and the sign-up form the site and the phone post,
// the invite gate in front of Better Auth's sign-up.

import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../device/device-schema";

const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

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
