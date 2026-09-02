import { z } from "zod";

// pairing refusals are distinct (the screen says "mint a new code" only when that is the
// fix, and a code is high-entropy and rate-limited, so the split leaks nothing spendable);
// a revoked and an unknown credential both answer `unauthorized`: "revoked" tells a thief it once worked.
export const CLOUD_ERROR_CODES = [
  "bad-request",
  "unauthorized",
  "not-found",
  "rate-limited",
  "invalid-code",
  "code-expired",
  "code-consumed",
  "device-limit",
  "sync-conflict",
  "sync-out-of-order",
  "account-deleted",
  // a new code is safe only on routes stale clients never call: their enum refuses it
  "file-too-large",
  "internal",
] as const;
export const cloudErrorCodeSchema = z.enum(CLOUD_ERROR_CODES);
export type CloudErrorCode = z.infer<typeof cloudErrorCodeSchema>;

// account-deleted is 410, not 401: told "unauthorized", a client retries the credential forever
export const CLOUD_ERROR_STATUS = {
  "bad-request": 400,
  unauthorized: 401,
  "not-found": 404,
  "rate-limited": 429,
  "invalid-code": 404,
  "code-expired": 410,
  "code-consumed": 409,
  "device-limit": 409,
  "sync-conflict": 409,
  "sync-out-of-order": 409,
  "account-deleted": 410,
  "file-too-large": 413,
  internal: 500,
} as const satisfies Record<CloudErrorCode, number>;

export const SYNC_TERMINAL_CODES: ReadonlySet<CloudErrorCode> = new Set([
  "unauthorized",
  "account-deleted",
]);

// this device's own outbox is wrong at the named deviceSeq: drop those rows, a resend is refused forever
export const SYNC_OUTBOX_CODES: ReadonlySet<CloudErrorCode> = new Set([
  "sync-conflict",
  "sync-out-of-order",
]);

export const cloudErrorSchema = z
  .object({
    error: z
      .object({
        code: cloudErrorCodeSchema,
        message: z.string(),
        // only on sync-conflict / sync-out-of-order: the outbox position that disagreed
        deviceSeq: z.number().int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();
export type CloudError = z.infer<typeof cloudErrorSchema>;

export function cloudError(code: CloudErrorCode, message: string, deviceSeq?: number): CloudError {
  const error: CloudError["error"] = { code, message };
  if (deviceSeq !== undefined) error.deviceSeq = deviceSeq;
  return { error };
}
