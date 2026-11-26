import { z } from "zod";

export const SIGN_IN_CODE_LENGTH = 6;

export const SIGN_IN_CODE_REFUSED = "That code didn't work. Check it, or send a new one.";

const SIGN_IN_CODE_REFUSALS: ReadonlyMap<string, string> = new Map([
  ["INVALID_OTP", SIGN_IN_CODE_REFUSED],
  ["OTP_EXPIRED", "That code has expired. Send a new one."],
  ["TOO_MANY_ATTEMPTS", "Too many tries. Send a new code."],
]);

/** What a person reads for Better Auth's refusal of a sign-in code, by its code; null for any other. */
export const signInCodeRefusal = (code: string | null | undefined) =>
  SIGN_IN_CODE_REFUSALS.get(code ?? "") ?? null;

const signInCodeSchema = z.string().trim().length(SIGN_IN_CODE_LENGTH).regex(/^\d+$/u);

const deviceSchema = z.object({
  createdAt: z.number().int(),
  current: z.boolean(),
  id: z.string().min(1),
  lastSeenAt: z.number().int(),
  name: z.string(),
});

export const listDevicesResponseSchema = z.object({
  devices: z.array(deviceSchema),
});

export const revokeDeviceRequestSchema = z.strictObject({ id: z.string().min(1) });

export const revokeDeviceResponseSchema = z.object({
  revoked: z.literal(true),
});

export const deleteAccountRequestSchema = z.strictObject({ code: signInCodeSchema });

export const deleteAccountResponseSchema = z.object({ deleted: z.literal(true) });

export const AUTH_API_PATHS = {
  signUp: "/api/sign-up",
  signUpCode: "/api/sign-up/code",
} as const;

export const signUpCodeRequestSchema = z.strictObject({
  email: z.string().trim().min(1),
  inviteCode: z.string().trim(),
});

export type SignUpCodeRequest = z.infer<typeof signUpCodeRequestSchema>;

export const signUpRequestSchema = signUpCodeRequestSchema.extend({
  code: signInCodeSchema,
  name: z.string().trim().min(1),
});

export type SignUpRequest = z.infer<typeof signUpRequestSchema>;
