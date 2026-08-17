import { DEVICE_CREDENTIAL_PREFIX } from "@repo/cloud-contract/pairing";
import { and, eq, isNull } from "drizzle-orm";
import type { createDb } from "../db/client";
import { device } from "../db/schema";

// ---------------------------------------------------------------------------
// Device-credential verification: the auth for /v1/sync/*, /v1/capture and
// /v1/artifacts/mint. A hash compare against D1 on EVERY request, never
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
