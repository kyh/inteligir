import {
  DEVICE_CREDENTIAL_PREFIX,
  DEVICE_PAIR_PURPOSE,
  PAIRING_CODE_PATTERN,
  PAIRING_CODE_TTL_MS,
  pkceChallengeS256,
  type MintPairingCodeResponse,
  type RedeemDeviceResponse,
} from "@repo/api/cloud/pairing/pairing-schema";
import { constantTimeEqual, hexFromBytes, sha256Hex } from "@repo/api/cloud/bytes";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { createDb } from "../db/client";
import { device, pairingCode } from "../db/schema";
import { forgetDeviceBudgets } from "../rate-limit";

// Pairing over D1 after bb's connect-code pattern (github.com/get-bb/bb, MIT).

type Db = ReturnType<typeof createDb>;

// same alphabet as the contract's PAIRING_CODE_PATTERN
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// enforced inside the insert as well, so the cap is a property of the table rather than of a check someone raced
const MAX_DEVICES_PER_ACCOUNT = 20;

function generatePairingCode(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let s = "";
  // 256 % 32 === 0, so the modulo is unbiased
  for (const b of buf) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function generateDeviceCredential(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return DEVICE_CREDENTIAL_PREFIX + hexFromBytes(buf);
}

// the sweep is per user and lazy: an expired row is already unusable, since redeem judges expiry in its own WHERE
export async function mintPairingCode(
  db: Db,
  userId: string,
  challenge: string,
): Promise<MintPairingCodeResponse> {
  const now = new Date();
  await db
    .delete(pairingCode)
    .where(
      and(
        eq(pairingCode.userId, userId),
        or(lt(pairingCode.expiresAt, now), sql`${pairingCode.consumedAt} IS NOT NULL`),
      ),
    );

  const code = generatePairingCode();
  await db.insert(pairingCode).values({
    code,
    userId,
    purpose: DEVICE_PAIR_PURPOSE,
    challenge,
    expiresAt: new Date(now.getTime() + PAIRING_CODE_TTL_MS),
    createdAt: now,
  });
  return { code, expiresInMs: PAIRING_CODE_TTL_MS };
}

type RedeemFailure = "invalid-code" | "code-expired" | "code-consumed" | "device-limit";

export type RedeemResult =
  | { readonly redeemed: true; readonly response: RedeemDeviceResponse }
  | { readonly redeemed: false; readonly failure: RedeemFailure };

function refuseRedeem(failure: RedeemFailure): RedeemResult {
  return { redeemed: false, failure };
}

// One D1 batch, which cannot roll back: the consume writes deviceId onto the code row and the
// insert is guarded on finding it there, so both land or neither. The cap subquery inside the
// insert is the real guard; the pre-check only answers the useful error before spending the code.
// Not replay-safe: only the hash is stored, so a lost response leaves a "Never connected" device
// to revoke from the dashboard, rather than storing the credential in the clear.
export async function redeemPairingCode(
  db: Db,
  d1: D1Database,
  rawCode: string,
  deviceName: string,
  verifier: string,
): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase();
  if (!PAIRING_CODE_PATTERN.test(code)) return refuseRedeem("invalid-code");

  const row = await db.select().from(pairingCode).where(eq(pairingCode.code, code)).get();
  if (row === undefined || row.purpose !== DEVICE_PAIR_PURPOSE) return refuseRedeem("invalid-code");
  if (row.consumedAt !== null) return refuseRedeem("code-consumed");
  if (row.expiresAt.getTime() < Date.now()) return refuseRedeem("code-expired");

  // PKCE before the consume: a mismatch leaves the code alive, so an interceptor's wrong-verifier
  // attempt neither reveals the miss nor burns the code the real app holds; a null challenge never matches
  if (row.challenge === null) return refuseRedeem("invalid-code");
  const presented = await pkceChallengeS256(verifier);
  if (!constantTimeEqual(presented, row.challenge)) return refuseRedeem("invalid-code");

  const openDevices = await db
    .select({ id: device.id })
    .from(device)
    .where(and(eq(device.userId, row.userId), isNull(device.revokedAt)))
    .all();
  if (openDevices.length >= MAX_DEVICES_PER_ACCOUNT) return refuseRedeem("device-limit");

  const credential = generateDeviceCredential();
  const deviceId = crypto.randomUUID();
  // epoch seconds: the schema's mode "timestamp" is what every other reader of these columns expects
  const nowSeconds = Math.floor(Date.now() / 1000);

  await d1.batch([
    d1
      .prepare(
        `UPDATE pairing_code SET consumed_at = ?, device_id = ?
         WHERE code = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?`,
      )
      .bind(nowSeconds, deviceId, code, DEVICE_PAIR_PURPOSE, nowSeconds),
    d1
      .prepare(
        `INSERT INTO device (id, user_id, name, credential_hash, created_at)
         SELECT ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM pairing_code WHERE code = ? AND device_id = ?)
           AND (SELECT COUNT(*) FROM device WHERE user_id = ? AND revoked_at IS NULL) < ?`,
      )
      .bind(
        deviceId,
        row.userId,
        deviceName,
        await sha256Hex(credential),
        nowSeconds,
        code,
        deviceId,
        row.userId,
        MAX_DEVICES_PER_ACCOUNT,
      ),
  ]);

  const created = await db
    .select({ id: device.id })
    .from(device)
    .where(eq(device.id, deviceId))
    .get();
  if (created === undefined) {
    // the consume lost to another redeem, or the cap subquery refused; the two have different fixes
    const after = await db.select().from(pairingCode).where(eq(pairingCode.code, code)).get();
    return refuseRedeem(after?.deviceId === deviceId ? "device-limit" : "code-consumed");
  }
  return { redeemed: true, response: { deviceId, credential } };
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
  await db.delete(pairingCode).where(eq(pairingCode.userId, userId));
  await forgetDeviceBudgets(
    db,
    owned.map((row) => row.id),
  );
}
