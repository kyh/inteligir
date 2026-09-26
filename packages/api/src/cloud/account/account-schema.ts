import { z } from "zod";
import {
  deviceLoginRequestSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../device/device-schema";

// its own route, not a field on the login response: 0.4.0 and older parse that response
// strictly, and a field they refuse fails their sign-in.
export const ACCOUNT_API_PATHS = {
  account: "/v1/account",
} as const;

export const accountResponseSchema = z.object({
  email: z.string().min(1),
  id: z.string().min(1),
});
export type AccountResponse = z.infer<typeof accountResponseSchema>;

// sign-up is the invite gate, not Better Auth's own route, and the emailed reset link lands on
// a Worker-served page, because it must work with no app installed
export const AUTH_PAGE_PATHS = {
  resetPage: "/auth/reset",
  signUp: "/v1/auth/sign-up",
} as const;

// the invite code is the gate's to refuse, so an empty one reads as a code that will not work
export const signUpRequestSchema = z
  .object({
    email: z.string().trim().min(1),
    inviteCode: z.string().trim(),
    name: z.string().trim().min(1),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  })
  .strict();
export type SignUpRequest = z.infer<typeof signUpRequestSchema>;

// the app's door to the same gate: its fields, the device's name, and the email folded as login
// folds it. here, not beside the login row: this file imports device-schema, not the reverse.
export const deviceSignUpRequestSchema = signUpRequestSchema
  .extend({
    deviceName: deviceLoginRequestSchema.shape.deviceName,
    email: deviceLoginRequestSchema.shape.email,
  })
  .strict();
export type DeviceSignUpRequest = z.infer<typeof deviceSignUpRequestSchema>;
