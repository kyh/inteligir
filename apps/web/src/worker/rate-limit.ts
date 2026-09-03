import { inArray, sql } from "drizzle-orm";
import type { createDb } from "./db/client";
import { rateLimit } from "./db/schema";

// Fixed windows over Better Auth's own rate_limit table. Unauthenticated callers are keyed
// on their address, verified devices on the device; the kill switch is read here, not per caller.

export type RateWindow = { readonly max: number; readonly windowMs: number };

// one upsert: a read-then-write limiter lets N concurrent requests all read the same count and
// all pass, so the count is read from the write itself
export async function allowInWindow(
  env: Env,
  db: ReturnType<typeof createDb>,
  key: string,
  window: RateWindow,
): Promise<boolean> {
  if (env.RATE_LIMIT_DISABLED === "true") {
    return true;
  }
  const nowMs = Date.now();
  const settled = await db
    .insert(rateLimit)
    .values({ id: crypto.randomUUID(), key, count: 1, lastRequest: nowMs })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`CASE WHEN ${nowMs} - ${rateLimit.lastRequest} > ${window.windowMs} THEN 1 ELSE ${rateLimit.count} + 1 END`,
        lastRequest: sql`CASE WHEN ${nowMs} - ${rateLimit.lastRequest} > ${window.windowMs} THEN ${nowMs} ELSE ${rateLimit.lastRequest} END`,
      },
    })
    .returning({ count: rateLimit.count })
    .get();
  // the counter climbs past max inside a spent window and resets when the next opens
  return settled === undefined || settled.count <= window.max;
}

// named here because eviction must spend the same spellings the routes do; the table has no foreign key
const DEVICE_RATE_KEY_PREFIXES = {
  vaultRead: "vault-read:",
  vaultGit: "vault-git:",
} as const;

export type DeviceRateFamily = keyof typeof DEVICE_RATE_KEY_PREFIXES;

export function deviceRateKey(family: DeviceRateFamily, deviceId: string): string {
  return `${DEVICE_RATE_KEY_PREFIXES[family]}${deviceId}`;
}

// nothing else deletes a row here, so a sign-in-then-revoke loop would leave rows behind forever
export async function forgetDeviceBudgets(
  db: ReturnType<typeof createDb>,
  deviceIds: readonly string[],
): Promise<void> {
  const keys = deviceIds.flatMap((deviceId) =>
    Object.values(DEVICE_RATE_KEY_PREFIXES).map((prefix) => `${prefix}${deviceId}`),
  );
  if (keys.length === 0) {
    return;
  }
  await db.delete(rateLimit).where(inArray(rateLimit.key, keys));
}

// the unauthenticated routes, keyed on the caller's address: nothing else about the caller is
// known yet, and a login with no throttle is a password oracle
const CALLER_RATE_KEY_PREFIXES = {
  login: "device-login:",
  inviteSignUp: "invite-signup:",
} as const;

export type CallerRateFamily = keyof typeof CALLER_RATE_KEY_PREFIXES;

export function callerRateKey(family: CallerRateFamily, request: Request): string {
  return `${CALLER_RATE_KEY_PREFIXES[family]}${request.headers.get("cf-connecting-ip") ?? "unknown"}`;
}
