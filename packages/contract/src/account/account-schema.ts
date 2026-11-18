import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

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

export const deleteAccountRequestSchema = z.strictObject({ password: passwordSchema });

export const deleteAccountResponseSchema = z.object({ deleted: z.literal(true) });

export const AUTH_API_PATHS = {
  signUp: "/api/sign-up",
} as const;

export const signUpRequestSchema = z.strictObject({
  email: z.string().trim().min(1),
  inviteCode: z.string().trim(),
  name: z.string().trim().min(1),
  password: passwordSchema,
});

export type SignUpRequest = z.infer<typeof signUpRequestSchema>;
