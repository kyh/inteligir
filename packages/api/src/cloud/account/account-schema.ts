import { z } from "zod";

// its own route, not a field on the redeem response: /cloud responses are
// .strict() and final, so a new redeem field breaks every stale install's pairing parse.
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
