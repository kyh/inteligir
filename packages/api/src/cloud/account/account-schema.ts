import { z } from "zod";

// its own route, not a field on the login response: /cloud responses are
// .strict() and final, so a new login field breaks every stale install's parse.
export const ACCOUNT_API_PATHS = {
  account: "/v1/account",
} as const;

export const accountResponseSchema = z
  .object({
    id: z.string().min(1),
    email: z.string().min(1),
  })
  .strict();
export type AccountResponse = z.infer<typeof accountResponseSchema>;
