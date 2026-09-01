import {
  DEVICE_CREDENTIAL_PREFIX,
  DEVICE_PAIR_PURPOSE,
  PAIRING_CODE_PATTERN,
  PAIRING_CODE_TTL_MS,
  pkceChallengeS256,
  type MintPairingCodeResponse,
  type RedeemDeviceResponse,
} from "@repo/api/cloud/pairing/pairing-schema";
import { constantTimeEqual, sha256Hex } from "@repo/api/cloud/bytes";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { createDb } from "../db/client";
import { device, pairingCode } from "../db/schema";
import { forgetDeviceBudgets } from "../rate-limit";

// ---------------------------------------------------------------------------
// Pairing-code mint and redeem over D1 (bb's connect-code pattern, MIT —
// github.com/get-bb/bb). The routes live in ./routes.ts; this module is the
// database logic, so the tests and the routes share one implementation.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof createDb>;

/** Same alphabet as the contract's PAIRING_CODE_PATTERN — no 0/O/1/I. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A household's devices, not a fleet. Enforced INSIDE the insert (below), so
 * the cap is a property of the table rather than of a check someone raced. */
const MAX_DEVICES_PER_ACCOUNT = 20;

function generatePairingCode(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let s = "";
  // 256 % 32 === 0, so the modulo is unbiased.
  for (const b of buf) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** 256-bit device credential; hex so the hash input is unambiguous ASCII. */
function generateDeviceCredential(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let hex = "";
  for (const b of buf) hex += b.toString(16).padStart(2, "0");
  return DEVICE_CREDENTIAL_PREFIX + hex;
}

/**
 * Mint a fresh code for `userId`, sweeping that user's dead rows (expired or
 * consumed) on the way.
 *
 * The sweep is PER USER and lazy, which is the whole of it: this account's
 * expired codes live until this account next mints. That is a deliberate
 * non-guarantee — a global sweep would need an alarm or a cron for rows that
 * are already unusable (redeem judges expiry in its own WHERE clause), and
 * `docs/privacy.md` states what remains rather than implying it is collected.
 */
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
    // The PKCE challenge is bound to the code here, at mint, so redeem can
    // demand the matching verifier — the whole of what stops an intercepted
    // code from being spent.
    challenge,
    expiresAt: new Date(now.getTime() + PAIRING_CODE_TTL_MS),
    createdAt: now,
  });
  return { code, expiresInMs: PAIRING_CODE_TTL_MS };
}

type RedeemFailure = "invalid-code" | "code-expired" | "code-consumed" | "device-limit";

/** The redeem outcome: the minted credential, or the reason it was refused. */
export type RedeemResult =
  | { readonly redeemed: true; readonly response: RedeemDeviceResponse }
  | { readonly redeemed: false; readonly failure: RedeemFailure };

function refuseRedeem(failure: RedeemFailure): RedeemResult {
  return { redeemed: false, failure };
}

/**
 * Consume `code` exactly once and mint the durable device credential, in ONE
 * D1 batch — a single transaction, so there is no window where a code is
 * burned without the device it paid for.
 *
 * The two statements are chained through the device id: the consume writes the
 * freshly-generated `deviceId` onto the code row, and the insert is guarded on
 * finding it there. Only THIS call could have written that id, so the insert
 * lands exactly when the consume won — which is how a conditional insert
 * survives a batch that has no way to abort halfway. Both conditions the
 * consume needs are in its own WHERE (`consumed_at IS NULL AND expires_at >
 * now AND purpose = …`), so nothing is judged in a read that a concurrent
 * redeem could invalidate between the check and the write.
 *
 * The cap is a subquery inside the insert, so twenty-one active devices are
 * unrepresentable rather than merely unlikely. The pre-check above it exists
 * only to answer with the useful error before spending the code; losing that
 * race burns a code and answers `device-limit`, which is the honest cost of a
 * batch that cannot roll back.
 *
 * NOT replay-safe by design, and this is the one place that matters: only the
 * credential's HASH is stored, so a redeem whose response was lost cannot be
 * answered again. The batch guarantees the device row exists, so the stray
 * device appears in the dashboard as "Never connected" and is revoked from
 * there; the user mints a new code. Returning the same credential twice would
 * mean storing it in the clear, which is a worse trade than a visible retry.
 */
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

  // PKCE, BEFORE the consume: a mismatch answers `invalid-code` and leaves the
  // code alive, so a wrong-verifier attempt by an interceptor neither reveals
  // the miss nor burns the code the real app still holds. A row with no stored
  // challenge (minted before this column, or somehow plain) can never match,
  // and is refused rather than waved through. The compare is constant-time,
  // and `S256(verifier)` is computed the contract's one way.
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
  // Timestamps are epoch SECONDS here: the schema's `mode: "timestamp"` is what
  // every other reader of these columns expects (see db/schema.ts).
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
    // The consume lost (another redeem of this code won) or the cap subquery
    // refused. Which one is a read away, and the read is worth it: the two
    // have completely different fixes.
    const after = await db.select().from(pairingCode).where(eq(pairingCode.code, code)).get();
    return refuseRedeem(after?.deviceId === deviceId ? "device-limit" : "code-consumed");
  }
  return { redeemed: true, response: { deviceId, credential } };
}

/**
 * Delete every device and pairing row `userId` owns — the account-deletion
 * hook's D1 half, and the step that must run FIRST: while a device row lives,
 * its credential still verifies, and a request already in flight on it can
 * reach the object the purge is about to empty.
 */
export async function purgeDeviceRows(db: Db, userId: string): Promise<void> {
  // The ids are read BEFORE the delete, and the budgets dropped after it: the
  // device rows still have to go first, and once they are gone nothing else
  // can name the limiter rows they left in the shared table.
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
