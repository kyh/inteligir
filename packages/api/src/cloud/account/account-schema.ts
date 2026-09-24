import { z } from "zod";

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
