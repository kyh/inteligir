import { inArray, sql } from "drizzle-orm";
import type { createDb } from "./db/client";
import { rateLimit } from "./db/schema";

// ---------------------------------------------------------------------------
// Fixed-window rate limiting over the shared `rate_limit` D1 table — the same
// table and the same shape Better Auth's own database limiter uses, so a route
// outside Better Auth gets the treatment the auth routes already have without
// a second store to reason about.
//
// TWO KINDS OF CALLER, and each budget means something different. An
// UNAUTHENTICATED one is keyed on its address, where the window makes guessing
// a code loud rather than carrying the entropy. A VERIFIED DEVICE is keyed on
// the DEVICE, where the window bounds how fast one credential drains the
// account's vault (CLAUDE.md carries that decision, and what it does not buy).
//
// The kill switch is read HERE rather than by each caller of this function.
// ---------------------------------------------------------------------------

/** A budget: at most `max` requests per `windowMs`, per key. */
export type RateWindow = { readonly max: number; readonly windowMs: number };

/**
 * Consume one unit of `key`'s budget; false once the window's budget is spent.
 * The window is fixed rather than sliding — `lastRequest` marks where it opened
 * and is only rewritten when a new one does.
 *
 * ONE statement, because a limiter that reads and then writes is a limiter with
 * a race in the middle: N concurrent requests all read the same count, all
 * decide they are under the cap, and all write it back — which is exactly the
 * burst a limiter exists to stop. The upsert does the whole decision in the
 * database (open a window, or increment inside the open one) and RETURNS the
 * count it settled on, so the answer is read from the write rather than from a
 * value that could already be stale.
 */
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
  // The counter keeps climbing past `max` inside a spent window, which is what
  // makes the check a simple comparison; it resets when the next window opens.
  return settled === undefined || settled.count <= window.max;
}

/**
 * The device-keyed families, NAMED HERE rather than at each route, because
 * eviction has to spend the same spellings the routes do: this table carries
 * no foreign key, so a revoked device's rows are unfindable from anywhere
 * that does not already know how they were written.
 */
const DEVICE_RATE_KEY_PREFIXES = {
  vaultRead: "vault-read:",
  vaultGit: "vault-git:",
} as const;

export type DeviceRateFamily = keyof typeof DEVICE_RATE_KEY_PREFIXES;

export function deviceRateKey(family: DeviceRateFamily, deviceId: string): string {
  return `${DEVICE_RATE_KEY_PREFIXES[family]}${deviceId}`;
}

/**
 * Drop every budget these devices hold — what revocation and account deletion
 * owe this table. Nothing else ever deletes a row here, so without it a
 * pair-then-revoke loop leaves two rows per cycle behind forever.
 */
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

/** The client IP a limiter keys on, or a shared bucket when the edge sent none. */
export function callerIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}
