import { sha256Hex } from "@repo/api/cloud/bytes";
import { DEVICE_CREDENTIAL_PREFIX } from "@repo/api/cloud/device/device-schema";
import { and, eq, isNull } from "drizzle-orm";
import type { createDb } from "../db/client";
import { device } from "../db/schema";

// A hash compare against D1 on every request, never cached: a cache with any TTL is the
// window a revoked credential keeps working through.

export type VerifiedDevice = {
  readonly deviceId: string;
  readonly userId: string;
};

// the igd_ prefix routes the bearer: a session token never reaches this table and a device credential never reaches Better Auth
export async function verifyDeviceCredential(
  db: ReturnType<typeof createDb>,
  authorization: string | null,
): Promise<VerifiedDevice | null> {
  const credential = bearerCredential(authorization);
  return credential === null ? null : await verifyDeviceCredentialValue(db, credential);
}

function bearerCredential(authorization: string | null): string | null {
  if (authorization === null) return null;
  const [scheme, credential, ...rest] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || credential === undefined || rest.length > 0) {
    return null;
  }
  return credential;
}

// Basic as well: a stock git client answers the vault remote's 401 that way with the credential
// as the password; a token put in the username slot still verifies, since the other field is empty then
export function deviceCredentialFromHeader(authorization: string | null): string | null {
  const bearer = bearerCredential(authorization);
  if (bearer !== null) return bearer;
  if (authorization === null) return null;
  const [scheme, value, ...rest] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "basic" || value === undefined || rest.length > 0) {
    return null;
  }
  let decoded: string;
  try {
    decoded = atob(value);
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  if (colon === -1) return decoded;
  const pass = decoded.slice(colon + 1);
  return pass !== "" ? pass : decoded.slice(0, colon);
}

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
