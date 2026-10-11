import { z } from "zod";

// a wrong password on the login route is `invalid-credentials`, not `unauthorized`: the latter
// ends a sync session, and a refused login is no verdict on any credential. a revoked and an
// unknown credential both answer `unauthorized`: "revoked" tells a thief it once worked.
export const CLOUD_ERROR_CODES = [
  "bad-request",
  "unauthorized",
  "invalid-credentials",
  "invite-refused",
  "account-exists",
  "not-found",
  "rate-limited",
  "device-limit",
  "sync-conflict",
  "sync-out-of-order",
  "account-deleted",
  "file-too-large",
  "vault-conflict",
  "vault-full",
  "client-outdated",
  "internal",
] as const;
export type CloudErrorCode = (typeof CLOUD_ERROR_CODES)[number];

// account-deleted is 410, not 401: told "unauthorized", a client retries the credential forever
export const CLOUD_ERROR_STATUS = {
  "account-deleted": 410,
  "account-exists": 409,
  "bad-request": 400,
  "client-outdated": 426,
  "device-limit": 409,
  "file-too-large": 413,
  internal: 500,
  "invalid-credentials": 401,
  "invite-refused": 403,
  "not-found": 404,
  "rate-limited": 429,
  "sync-conflict": 409,
  "sync-out-of-order": 409,
  unauthorized: 401,
  "vault-conflict": 409,
  "vault-full": 507,
} as const satisfies Record<CloudErrorCode, number>;

// the credential is dead: only a sign-in, which replaces it, comes back from these
export const CREDENTIAL_REFUSED_CODES: ReadonlySet<CloudErrorCode> = new Set([
  "unauthorized",
  "account-deleted",
]);

// a session that hears one of these ends. client-outdated leaves the credential live: the build is
// below the cloud's floor, and only an update moves past it, so a retry would be refused forever
export const SYNC_TERMINAL_CODES: ReadonlySet<CloudErrorCode> = new Set([
  ...CREDENTIAL_REFUSED_CODES,
  "client-outdated",
]);

// this device's own outbox is wrong at the named deviceSeq: drop those rows, a resend is refused forever
export const SYNC_OUTBOX_CODES: ReadonlySet<CloudErrorCode> = new Set([
  "sync-conflict",
  "sync-out-of-order",
]);

// a code this build does not know is a newer worker's: `internal` retries it and keeps the
// worker's message, where refusing the envelope would read it as a body this build cannot read
const errorCodeSchema = z
  .string()
  .transform(
    (code): CloudErrorCode => CLOUD_ERROR_CODES.find((known) => known === code) ?? "internal",
  );

export const cloudErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    // only on sync-conflict / sync-out-of-order: the outbox position that disagreed
    deviceSeq: z.number().int().nonnegative().optional(),
    message: z.string(),
  }),
});
export type CloudError = z.infer<typeof cloudErrorSchema>;

export const cloudError = (
  code: CloudErrorCode,
  message: string,
  deviceSeq?: number,
): CloudError => {
  const error: CloudError["error"] = { code, message };
  if (deviceSeq !== undefined) {
    error.deviceSeq = deviceSeq;
  }
  return { error };
};
