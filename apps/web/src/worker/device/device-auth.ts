import { DEVICE_CREDENTIAL_PREFIX } from "@repo/api/cloud/pairing/pairing-schema";
import { and, eq, isNull } from "drizzle-orm";
import type { createDb } from "../db/client";
import { device } from "../db/schema";

// ---------------------------------------------------------------------------
// Device-credential verification: the auth for /v1/sync/*, /v1/capture and
// the vault git remote. A hash compare against D1 on EVERY request, never
// cached — dashboard revocation must bite on the device's next request, and a
// cache with any TTL would be exactly the window a revoked credential keeps
// working through (bb caches here and pays for it with a "fresh" bypass).
// ---------------------------------------------------------------------------

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let hex = "";
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * A length-independent, content-independent-timing equality on two strings.
 *
 * workerd carries no `crypto.timingSafeEqual` (that is node's), so the PKCE
 * challenge compare at redeem does it by hand: fold the length difference into
 * the accumulator and XOR every code unit, so the loop runs the longer string's
 * length whatever the inputs are. Both operands here are 43-char base64url, but
 * the guard is written not to depend on that.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export type VerifiedDevice = {
  readonly deviceId: string;
  readonly userId: string;
};

/**
 * Resolve the `Authorization` header to the device that owns it, or null.
 *
 * The `igd_` prefix routes the bearer: a Better Auth session token never
 * reaches this table and a device credential never reaches Better Auth, so
 * the two bearer vocabularies cannot shadow each other. Lookup is BY HASH
 * (indexed, unique), so an unknown credential costs one miss — and equality is
 * exact on the digest, which no timing can narrow. The `lastSeenAt` write is
 * the dashboard's liveness column; one indexed D1 UPDATE per request is the
 * price of never caching.
 */
export async function verifyDeviceCredential(
  db: ReturnType<typeof createDb>,
  authorization: string | null,
): Promise<VerifiedDevice | null> {
  if (authorization === null) return null;
  const [scheme, credential, ...rest] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || credential === undefined || rest.length > 0) {
    return null;
  }
  return await verifyDeviceCredentialValue(db, credential);
}

/**
 * The value-level half, for the one surface where the credential arrives
 * outside a Bearer header: the vault git remote, where a stock git client
 * answers the 401 challenge with HTTP Basic and the credential is the
 * password. The `igd_` prefix check stays here so both carriers route
 * through the same vocabulary split.
 */
export async function verifyDeviceCredentialValue(
  db: ReturnType<typeof createDb>,
  credential: string,
): Promise<VerifiedDevice | null> {
  if (!credential.startsWith(DEVICE_CREDENTIAL_PREFIX)) return null;

  const hash = await sha256Hex(credential);
  const row = await db
    .select({ deviceId: device.id, userId: device.userId })
    .from(device)
    .where(and(eq(device.credentialHash, hash), isNull(device.revokedAt)))
    .get();
  if (row === undefined) return null;

  await db.update(device).set({ lastSeenAt: new Date() }).where(eq(device.id, row.deviceId));
  return row;
}
