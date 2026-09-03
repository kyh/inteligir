import {
  DEVICE_CREDENTIAL_PREFIX,
  type DeviceLoginResponse,
} from "@repo/api/cloud/device/device-schema";
import { hexFromBytes, sha256Hex } from "@repo/api/cloud/bytes";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import type { createAuth } from "../auth/auth";
import type { createDb } from "../db/client";
import { device, session } from "../db/schema";
import { forgetDeviceBudgets } from "../rate-limit";

// A device joins an account the way Obsidian Sync does: the account's own email and password,
// verified by Better Auth, answered with a device credential minted here.

type Db = ReturnType<typeof createDb>;
type Auth = ReturnType<typeof createAuth>;

// enforced inside the insert as well, so the cap is a property of the table rather than of a check someone raced
const MAX_DEVICES_PER_ACCOUNT = 20;

function generateDeviceCredential(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return DEVICE_CREDENTIAL_PREFIX + hexFromBytes(buf);
}

export type LoginFailure = "invalid-credentials" | "device-limit";

export type LoginResult =
  | { readonly loggedIn: true; readonly response: DeviceLoginResponse }
  | { readonly loggedIn: false; readonly failure: LoginFailure };

function refuseLogin(failure: LoginFailure): LoginResult {
  return { loggedIn: false, failure };
}

export interface LoginArgs {
  email: string;
  password: string;
  deviceName: string;
}

// Not replay-safe: only the hash is stored, so a lost response leaves a "Never connected" device
// to revoke from the dashboard, rather than storing the credential in the clear.
export async function loginDevice(
  db: Db,
  d1: D1Database,
  auth: Auth,
  args: LoginArgs,
): Promise<LoginResult> {
  let signedIn: { token: string; user: { id: string } };
  try {
    signedIn = await auth.api.signInEmail({ body: { email: args.email, password: args.password } });
  } catch (error) {
    // 401 is INVALID_EMAIL_OR_PASSWORD, which is also what a user with no credential account and no
    // password gets; anything else is a fault, not a refusal
    if (error instanceof APIError && error.statusCode === 401) {
      return refuseLogin("invalid-credentials");
    }
    throw error;
  }
  // the sign-in minted a browser session this device must never hold: the igd_ credential is
  // its only key, revocable from /app/devices, and a session row nobody sees is a bearer nobody revokes
  await db.delete(session).where(eq(session.token, signedIn.token));

  const credential = generateDeviceCredential();
  const deviceId = crypto.randomUUID();
  // epoch seconds: the schema's mode "timestamp" is what every other reader of these columns expects
  const nowSeconds = Math.floor(Date.now() / 1000);
  // the cap subquery inside the insert is the guard: two logins racing the twentieth slot both
  // count before either lands, and only the statement itself sees the other's row
  const inserted = await d1
    .prepare(
      `INSERT INTO device (id, user_id, name, credential_hash, created_at)
       SELECT ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM device WHERE user_id = ? AND revoked_at IS NULL) < ?`,
    )
    .bind(
      deviceId,
      signedIn.user.id,
      args.deviceName,
      await sha256Hex(credential),
      nowSeconds,
      signedIn.user.id,
      MAX_DEVICES_PER_ACCOUNT,
    )
    .run();
  if (inserted.meta.changes === 0) return refuseLogin("device-limit");
  return { loggedIn: true, response: { deviceId, credential } };
}

// must run first in account deletion: while a device row lives, its credential still verifies
export async function purgeDeviceRows(db: Db, userId: string): Promise<void> {
  // ids read before the delete: once the rows are gone nothing else can name their limiter rows
  const owned = await db
    .select({ id: device.id })
    .from(device)
    .where(eq(device.userId, userId))
    .all();
  await db.delete(device).where(eq(device.userId, userId));
  await forgetDeviceBudgets(
    db,
    owned.map((row) => row.id),
  );
}
