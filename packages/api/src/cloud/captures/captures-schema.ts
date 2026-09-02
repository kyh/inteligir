import { z } from "zod";

// delivery is at-least-once, deletion exactly-once by the owning claim, so a client's
// apply must be idempotent on the capture id: a device that claims and dies before
// acking has its rows return to the pool after CAPTURE_CLAIM_TTL_MS and delivered again.

export const CAPTURE_API_PATHS = {
  capture: "/v1/capture",
  claim: "/v1/sync/captures/claim",
  ack: "/v1/sync/captures/ack",
} as const;

export const CAPTURE_MAX_CHARS = 4096;
export const CAPTURE_CLAIM_TTL_MS = 5 * 60_000;
export const CLAIM_DEFAULT_LIMIT = 100;
export const CLAIM_MAX_LIMIT = 500;

export const captureRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(CAPTURE_MAX_CHARS),
    // required, not optional: a share-sheet retry after a lost response would duplicate the note
    idempotencyKey: z.string().trim().min(8).max(128),
  })
  .strict();
export type CaptureRequest = z.infer<typeof captureRequestSchema>;

export const captureResponseSchema = z
  .object({
    id: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
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

export const claimCapturesRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(CLAIM_MAX_LIMIT).default(CLAIM_DEFAULT_LIMIT),
  })
  .strict();
export type ClaimCapturesRequest = z.infer<typeof claimCapturesRequestSchema>;

export const claimCapturesResponseSchema = z
  .object({
    // answered even with no rows: a nullable token is a branch every client must write
    claimToken: z.string().min(1),
    captures: z.array(captureRowSchema),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type ClaimCapturesResponse = z.infer<typeof claimCapturesResponseSchema>;

export const ackCapturesRequestSchema = z
  .object({
    claimToken: z.string().min(1),
    ids: z.array(z.string().min(1)).min(1).max(CLAIM_MAX_LIMIT),
  })
  .strict();
export type AckCapturesRequest = z.infer<typeof ackCapturesRequestSchema>;

// reclaimed: this claim lapsed and another device owns the row, so the local apply is
// provisional (the owner applies it again); unknown: already deleted or never existed.
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
