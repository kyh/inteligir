import { z } from "zod";

// ---------------------------------------------------------------------------
// The capture inbox: a durable row per quick capture, held in the user's
// ThreadSyncDO until a device applies it to the daily note and acks.
//
// THE GUARANTEE, stated exactly, because the tempting words are wrong:
//
//   Delivery is AT-LEAST-ONCE. Deletion is exactly-once, by the claim that
//   owned the row. Applying must be IDEMPOTENT on the client, keyed by the
//   capture's `id`.
//
// It is a two-phase handoff. `claim` marks a batch with a token and hands back
// the payload; `ack` deletes only the rows still carrying that token. Between
// them exactly one device owns each row, so two devices syncing at once cannot
// both apply — the flaw in a bare list-then-delete, where the list is a read
// anyone can win and the delete is a fact only one of them learns.
//
// The residual is honest and is why "exactly-once delivery" is NOT claimed: a
// device that claims, applies, and dies before acking leaves the row claimed.
// The claim expires after CAPTURE_CLAIM_TTL_MS and the row returns to the
// pool, so the capture is not lost — it is delivered again, to whoever claims
// next. That is the trade: a lost capture is unrecoverable, a duplicated one
// is deduplicated by an idempotent apply.
// ---------------------------------------------------------------------------

/** Where the inbox is served — see `DEVICE_API_PATHS` for why a path lives
 *  beside its schemas. */
export const CAPTURE_API_PATHS = {
  capture: "/v1/capture",
  claim: "/v1/sync/captures/claim",
  ack: "/v1/sync/captures/ack",
} as const;

export const CAPTURE_MAX_CHARS = 4096;
/** How long a claim owns its rows before they return to the pool. Long enough
 * to survive a slow vault write, short enough that a crashed device does not
 * strand today's captures until someone notices. */
export const CAPTURE_CLAIM_TTL_MS = 5 * 60_000;
export const CLAIM_DEFAULT_LIMIT = 100;
export const CLAIM_MAX_LIMIT = 500;

// POST /v1/capture (device-authed).
export const captureRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(CAPTURE_MAX_CHARS),
    /** Client-minted, stable across retries of the SAME capture. Required
     * rather than optional: a share-sheet retry after a lost response is the
     * ordinary case, and a server that cannot tell it from a second thought
     * duplicates the user's note. */
    idempotencyKey: z.string().trim().min(8).max(128),
  })
  .strict();
export type CaptureRequest = z.infer<typeof captureRequestSchema>;

export const captureResponseSchema = z
  .object({
    id: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    /** True when this key had already been captured — the row is the original,
     * not a new one. */
    duplicate: z.boolean(),
  })
  .strict();
export type CaptureResponse = z.infer<typeof captureResponseSchema>;

export const captureRowSchema = z
  .object({
    id: z.string().min(1),
    text: z.string(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type CaptureRow = z.infer<typeof captureRowSchema>;

// POST /v1/sync/captures/claim (device-authed).
export const claimCapturesRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(CLAIM_MAX_LIMIT).default(CLAIM_DEFAULT_LIMIT),
  })
  .strict();
export type ClaimCapturesRequest = z.infer<typeof claimCapturesRequestSchema>;

export const claimCapturesResponseSchema = z
  .object({
    /** Present the token back on `ack`. A claim with no rows still answers one
     * — the caller has nothing to ack, and a nullable token would be a branch
     * every client has to write. */
    claimToken: z.string().min(1),
    captures: z.array(captureRowSchema),
    /** When this claim lapses and its rows return to the pool. */
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type ClaimCapturesResponse = z.infer<typeof claimCapturesResponseSchema>;

// POST /v1/sync/captures/ack (device-authed).
export const ackCapturesRequestSchema = z
  .object({
    claimToken: z.string().min(1),
    ids: z.array(z.string().min(1)).min(1).max(CLAIM_MAX_LIMIT),
  })
  .strict();
export type AckCapturesRequest = z.infer<typeof ackCapturesRequestSchema>;

/**
 * What happened to one id, per id — an aggregate count cannot tell a caller
 * WHICH of its applies committed, and a caller that guesses either drops a
 * capture or writes it twice.
 *
 * - `deleted`  — this claim owned it; it is gone. The apply is committed.
 * - `reclaimed` — the row is here but carries someone else's token: this claim
 *   lapsed and another device owns it now. Whatever this device applied will
 *   be applied again by the owner, so treat the local apply as provisional.
 * - `unknown`  — no such row: already deleted (by the owner of a later claim),
 *   or never existed. Nothing to do.
 */
export const ackOutcomeSchema = z.enum(["deleted", "reclaimed", "unknown"]);
export type AckOutcome = z.infer<typeof ackOutcomeSchema>;

export const ackCapturesResponseSchema = z
  .object({
    results: z
      .array(z.object({ id: z.string().min(1), outcome: ackOutcomeSchema }).strict())
      .max(CLAIM_MAX_LIMIT),
  })
  .strict();
export type AckCapturesResponse = z.infer<typeof ackCapturesResponseSchema>;
