import { z } from "zod";

/**
 * Every refusal the cloud Worker's `/v1/device/*`, `/v1/sync/*` and
 * `/v1/capture` routes can answer. One envelope, one code enum, so the
 * app renders every failure through one path and a new refusal is a compile
 * error in the client's switch rather than an unstyled string.
 *
 * The pairing codes are deliberately DISTINCT ("invalid" vs "expired" vs
 * "consumed"): the local app's pairing screen needs to say "mint a new code"
 * only when that is the fix, and a pairing code is high-entropy and
 * rate-limited, so the distinction leaks nothing an attacker can spend.
 * Device-credential failures are the opposite — a revoked credential and an
 * unknown one both answer `unauthorized`, because "revoked" confirms to whoever
 * holds a stolen credential that it used to work.
 *
 * The two sync codes are how a device learns its own outbox is wrong rather
 * than merely behind: `sync-conflict` is one position replayed with a DIFFERENT
 * body, `sync-out-of-order` is a position that would reverse causality. Both
 * name the offending `deviceSeq` — a client that cannot see WHICH position
 * disagreed can only resend the batch that already failed.
 */
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
  // Vault read rows only (a new code is additive-safe exactly because stale
  // clients never call the new routes): the file exists but exceeds the text
  // ceiling this wire carries.
  "file-too-large",
  "internal",
] as const;
export const cloudErrorCodeSchema = z.enum(CLOUD_ERROR_CODES);
export type CloudErrorCode = z.infer<typeof cloudErrorCodeSchema>;

/**
 * The HTTP status each code answers with — part of the wire, so it lives
 * beside the enum: the Worker serves it and the CLI's test fake must answer
 * the SAME numbers, and `satisfies` alone pins exhaustiveness, not values.
 * "account-deleted" is Gone rather than 401 on purpose: the credential was
 * fine, the account it named is not — a client told "unauthorized" retries
 * the credential forever.
 */
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

export const cloudErrorSchema = z
  .object({
    error: z
      .object({
        code: cloudErrorCodeSchema,
        message: z.string(),
        /** Present only on `sync-conflict` / `sync-out-of-order`: the device
         * outbox position that disagreed. */
        deviceSeq: z.number().int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();
export type CloudError = z.infer<typeof cloudErrorSchema>;

/** Build the envelope. Pure — the transport (status line, headers) is the
 * server's; the app matches on `code`, never on the message or the status. */
export function cloudError(code: CloudErrorCode, message: string, deviceSeq?: number): CloudError {
  const error: CloudError["error"] = { code, message };
  if (deviceSeq !== undefined) error.deviceSeq = deviceSeq;
  return { error };
}
