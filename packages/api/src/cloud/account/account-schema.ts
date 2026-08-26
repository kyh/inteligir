import { z } from "zod";

// ---------------------------------------------------------------------------
// `GET /v1/account` (device-authed): whose account this credential syncs as.
// The account is the entitlement (owner decision 2026-08-25, issue #618), so
// the product must be able to SAY which account an install is entitled by —
// after the approve page closes, this row is the only place that fact can
// come from.
//
// A NEW route rather than a field on the redeem response, deliberately:
// /cloud responses are `.strict()` and final at birth, so adding a redeem
// field would make every stale install's pairing parse fail as malformed.
// A new route is called only by builds that know it.
// ---------------------------------------------------------------------------

export const ACCOUNT_API_PATHS = {
  account: "/v1/account",
} as const;

export const accountResponseSchema = z
  .object({
    /** The account's email — display identity, never an address to send to. */
    email: z.string().min(1),
  })
  .strict();
export type AccountResponse = z.infer<typeof accountResponseSchema>;
