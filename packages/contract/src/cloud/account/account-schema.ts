import { z } from "zod";
import type { CloudErrorCode } from "../cloud-errors";
import {
  deviceLoginRequestSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../device/device-schema";

export const ACCOUNT_API_PATHS = {
  delete: "/v1/account/delete",
} as const;

// asked with a device credential, which alone would let whoever holds a stolen one end the
// account: the password is asked again
export const deleteAccountRequestSchema = z
  .object({ password: deviceLoginRequestSchema.shape.password })
  .strict();
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

export const deleteAccountResponseSchema = z.object({ deleted: z.literal(true) });
export type DeleteAccountResponse = z.infer<typeof deleteAccountResponseSchema>;

// what the delete route answers besides bad-request and the credential's own refusals
export const DELETE_ACCOUNT_REFUSALS = [
  "invalid-credentials",
  "rate-limited",
] as const satisfies readonly CloudErrorCode[];
export type DeleteAccountRefusal = (typeof DELETE_ACCOUNT_REFUSALS)[number];

export const isDeleteAccountRefusal = (code: CloudErrorCode): code is DeleteAccountRefusal =>
  DELETE_ACCOUNT_REFUSALS.some((refusal) => refusal === code);

// sign-up is the invite gate, not Better Auth's own route
export const AUTH_API_PATHS = {
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
