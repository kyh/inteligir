// What `account.*` reads to make and end an account, and the site's own sign-up form, the invite
// gate in front of Better Auth's sign-up.

import { z } from "zod";
import {
  deviceLoginRequestSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../device/device-schema";

// asked with a credential, which alone would let whoever holds a stolen one end the account: the
// password is asked again
export const deleteAccountRequestSchema = z.strictObject({
  password: deviceLoginRequestSchema.shape.password,
});

export const deleteAccountResponseSchema = z.object({ deleted: z.literal(true) });

// the site's sign-up form posts to the invite gate, beside Better Auth's own routes, never to
// Better Auth's sign-up itself
export const AUTH_API_PATHS = {
  signUp: "/api/sign-up",
} as const;

// the invite code is the gate's to refuse, so an empty one reads as a code that will not work
export const signUpRequestSchema = z.strictObject({
  email: z.string().trim().min(1),
  inviteCode: z.string().trim(),
  name: z.string().trim().min(1),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type SignUpRequest = z.infer<typeof signUpRequestSchema>;

// the app's door to the same gate: its fields, the device's name, and the email folded as login
// folds it. here, not beside the login row: this file imports device-schema, not the reverse.
export const deviceSignUpRequestSchema = signUpRequestSchema.extend({
  deviceName: deviceLoginRequestSchema.shape.deviceName,
  email: deviceLoginRequestSchema.shape.email,
});
export type DeviceSignUpRequest = z.infer<typeof deviceSignUpRequestSchema>;
