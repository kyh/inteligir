import { sha256Hex } from "@repo/contract/cloud/bytes";
import { DEVICE_CREDENTIAL_PREFIX } from "@repo/contract/cloud/device/device-schema";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { device } from "../db/schema";

// A hash compare against D1 on every request, never cached: a cache with any TTL is the
// window a revoked credential keeps working through.

// last seen is written at most this often per device: every sync and dispatch call verifies,
// and a D1 write on each kept current a devices page nobody reads to the second
export const LAST_SEEN_RESOLUTION_MS = 5 * 60_000;

export interface VerifiedDevice {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly userId: string;
}

const bearerCredential = (authorization: string | null): string | null => {
  if (authorization === null) {
    return null;
  }
  const [scheme, credential, ...rest] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || credential === undefined || rest.length > 0) {
    return null;
  }
  return credential;
};

const verifyDeviceCredentialValue = async (
  db: Db,
  credential: string,
): Promise<VerifiedDevice | null> => {
  if (!credential.startsWith(DEVICE_CREDENTIAL_PREFIX)) {
    return null;
  }

  const hash = await sha256Hex(credential);
  const live = and(eq(device.credentialHash, hash), isNull(device.revokedAt));
  const row = await db
    .select({
      deviceId: device.id,
      deviceName: device.name,
      lastSeenAt: device.lastSeenAt,
      userId: device.userId,
    })
    .from(device)
    .where(live)
    .get();
  if (row === undefined) {
    return null;
  }

  const now = new Date();
  if (
    row.lastSeenAt !== null &&
    now.getTime() - row.lastSeenAt.getTime() < LAST_SEEN_RESOLUTION_MS
  ) {
    return { deviceId: row.deviceId, deviceName: row.deviceName, userId: row.userId };
  }
  // the touch is the verdict: a revoke committed since the read refuses this request too
  const touched = await db
    .update(device)
    .set({ lastSeenAt: now })
    .where(live)
    .returning({ deviceId: device.id, deviceName: device.name, userId: device.userId })
    .get();
  return touched ?? null;
};

// the igd_ prefix routes the bearer: a session token never reaches this table and a device credential never reaches Better Auth
export const verifyDeviceCredential = async (
  db: Db,
  authorization: string | null,
): Promise<VerifiedDevice | null> => {
  const credential = bearerCredential(authorization);
  return credential === null ? null : await verifyDeviceCredentialValue(db, credential);
};

export const carriesDeviceCredential = (authorization: string | null): boolean =>
  bearerCredential(authorization)?.startsWith(DEVICE_CREDENTIAL_PREFIX) ?? false;
