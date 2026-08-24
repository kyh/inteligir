import { z } from "zod";

/**
 * Every refusal the cloud Worker's `/v1/device/*`, `/v1/sync/*`, `/v1/capture`
 * and `/v1/artifacts/*` routes can answer. One envelope, one code enum, so the
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
  "artifacts-not-enabled",
  "internal",
] as const;
export const cloudErrorCodeSchema = z.enum(CLOUD_ERROR_CODES);
export type CloudErrorCode = z.infer<typeof cloudErrorCodeSchema>;

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
