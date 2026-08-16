import { z } from "zod";

// ---------------------------------------------------------------------------
// The capture inbox: a durable row per quick capture, held in the user's
// ThreadSyncDO until a device applies it to the daily note and ACKS. The ack
// DELETES — exactly-once handoff by construction: whichever device acks first
// owns the capture, and a re-listed id after a lost ack response is applied
// idempotently client-side (the ack is the commit, the apply is the work).
// ---------------------------------------------------------------------------

export const CAPTURE_MAX_CHARS = 4096;

// POST /v1/capture (device-authed).
export const captureRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(CAPTURE_MAX_CHARS),
  })
  .strict();
export type CaptureRequest = z.infer<typeof captureRequestSchema>;

export const captureResponseSchema = z
  .object({
    id: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
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

// GET /v1/sync/captures (device-authed).
export const listCapturesResponseSchema = z
  .object({
    captures: z.array(captureRowSchema),
  })
  .strict();
export type ListCapturesResponse = z.infer<typeof listCapturesResponseSchema>;

// POST /v1/sync/captures/ack (device-authed).
export const ackCapturesRequestSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(500),
  })
  .strict();
export type AckCapturesRequest = z.infer<typeof ackCapturesRequestSchema>;

/** `deleted` counts rows this ack actually removed — an id someone else
 * already acked counts zero, which is the loser's signal not to apply. */
export const ackCapturesResponseSchema = z
  .object({
    deleted: z.number().int().nonnegative(),
  })
  .strict();
export type AckCapturesResponse = z.infer<typeof ackCapturesResponseSchema>;
