import {
  DEVICE_CREDENTIAL_PREFIX,
  DEVICE_PAIR_PURPOSE,
  PAIRING_CODE_PATTERN,
  PAIRING_CODE_TTL_MS,
  type MintPairingCodeResponse,
  type RedeemDeviceResponse,
} from "@repo/cloud-contract/pairing";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { sha256Hex } from "./device-auth";
import type { createDb } from "../db/client";
import { device, pairingCode } from "../db/schema";

// ---------------------------------------------------------------------------
// Pairing-code mint and redeem over D1 (bb's connect-code pattern, MIT —
// github.com/get-bb/bb). The routes live in ./routes.ts; this module is the
// database logic, so the tests and the routes share one implementation.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof createDb>;

/** Same alphabet as the contract's PAIRING_CODE_PATTERN — no 0/O/1/I. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Enough that N codes minted while under the cap cannot matter; a household's
 * devices, not a fleet. Re-checked at redeem, where it is atomic-adjacent. */
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
 * consumed) on the way — the lazy sweep that keeps the table a handful of live
 * rows without an alarm or a cron.
 */
export async function mintPairingCode(db: Db, userId: string): Promise<MintPairingCodeResponse> {
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
    expiresAt: new Date(now.getTime() + PAIRING_CODE_TTL_MS),
    createdAt: now,
  });
  return { code, expiresInMs: PAIRING_CODE_TTL_MS };
}

export type RedeemFailure = "invalid-code" | "code-expired" | "code-consumed" | "device-limit";

/**
 * Consume `code` exactly once and mint the durable device credential.
 *
 * ORDER MATTERS, twice. The device cap is re-checked HERE, not only at mint
 * (N codes each minted under the limit could all redeem past it), and BEFORE
 * the consume, so a cap-rejected redeem leaves the code usable. The consume
 * itself is the one atomic step — `UPDATE … WHERE consumed_at IS NULL` — so
 * two simultaneous redeems of one code settle on exactly one credential.
 */
export async function redeemPairingCode(
  db: Db,
  rawCode: string,
  deviceName: string,
): Promise<RedeemDeviceResponse | RedeemFailure> {
  const code = rawCode.trim().toUpperCase();
  if (!PAIRING_CODE_PATTERN.test(code)) return "invalid-code";

  const row = await db.select().from(pairingCode).where(eq(pairingCode.code, code)).get();
  if (row === undefined || row.purpose !== DEVICE_PAIR_PURPOSE) return "invalid-code";
  if (row.consumedAt !== null) return "code-consumed";
  if (row.expiresAt.getTime() < Date.now()) return "code-expired";

  const openDevices = await db
    .select({ id: device.id })
    .from(device)
    .where(and(eq(device.userId, row.userId), isNull(device.revokedAt)))
    .all();
  if (openDevices.length >= MAX_DEVICES_PER_ACCOUNT) return "device-limit";

  const consumed = await db
    .update(pairingCode)
    .set({ consumedAt: new Date() })
    .where(and(eq(pairingCode.code, code), isNull(pairingCode.consumedAt)))
    .returning()
    .get();
  if (consumed === undefined) return "code-consumed";

  const credential = generateDeviceCredential();
  const deviceId = crypto.randomUUID();
  await db.insert(device).values({
    id: deviceId,
    userId: row.userId,
    name: deviceName,
    credentialHash: await sha256Hex(credential),
    createdAt: new Date(),
  });
  return { deviceId, credential };
}

/**
 * Delete every device and pairing row `userId` owns — the account-deletion
 * hook's D1 half. Explicit rather than left to FK cascade, so the guarantee is
 * this repo's own statement instead of a PRAGMA the platform owns.
 */
export async function purgeDeviceRows(db: Db, userId: string): Promise<void> {
  await db.delete(device).where(eq(device.userId, userId));
  await db.delete(pairingCode).where(eq(pairingCode.userId, userId));
}
