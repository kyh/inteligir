import { inArray, sql } from "drizzle-orm";
import type { createDb } from "./db/client";
import { rateLimit } from "./db/schema";

// Fixed windows over Better Auth's own rate_limit table, which Better Auth prunes on its own
// writes: a row whose last request is older than its longest window goes, the Worker's included.
// Unauthenticated callers are keyed on their address, verified devices on the device; the kill
// switch is read here, not per caller.

export interface RateWindow {
  readonly max: number;
  readonly windowMs: number;
}

// Better Auth's own window (./auth/auth.ts), in its unit. A row here keeps its window's start as
// its last request, so a window no longer than this is pruned only after it lapsed; a longer one
// would lose its count mid-window, which the rate-window guard refuses.
export const AUTH_RATE_WINDOW_SECONDS = 60;

// one upsert: a read-then-write limiter lets N concurrent requests all read the same count and
// all pass, so the count is read from the write itself
export const allowInWindow = async (
  env: Env,
  db: ReturnType<typeof createDb>,
  key: string,
  window: RateWindow,
): Promise<boolean> => {
  if (env.RATE_LIMIT_DISABLED === "true") {
    return true;
  }
  const nowMs = Date.now();
  const settled = await db
    .insert(rateLimit)
    .values({ count: 1, id: crypto.randomUUID(), key, lastRequest: nowMs })
    .onConflictDoUpdate({
      set: {
        count: sql`CASE WHEN ${nowMs} - ${rateLimit.lastRequest} > ${window.windowMs} THEN 1 ELSE ${rateLimit.count} + 1 END`,
        lastRequest: sql`CASE WHEN ${nowMs} - ${rateLimit.lastRequest} > ${window.windowMs} THEN ${nowMs} ELSE ${rateLimit.lastRequest} END`,
      },
      target: rateLimit.key,
    })
    .returning({ count: rateLimit.count })
    .get();
  // the counter climbs past max inside a spent window and resets when the next opens
  return settled === undefined || settled.count <= window.max;
};

// named here because eviction must spend the same spellings the routes do; the table has no foreign key
const DEVICE_RATE_KEY_PREFIXES = {
  vaultGit: "vault-git:",
  vaultRead: "vault-read:",
} as const;

type DeviceRateFamily = keyof typeof DEVICE_RATE_KEY_PREFIXES;

export const deviceRateKey = (family: DeviceRateFamily, deviceId: string): string =>
  `${DEVICE_RATE_KEY_PREFIXES[family]}${deviceId}`;

// Better Auth's prune reaches a row only after its window lapsed, and only when one of Better
// Auth's own windows rolls over; a revoked device's budget names nobody, so it goes at once
export const forgetDeviceBudgets = async (
  db: ReturnType<typeof createDb>,
  deviceIds: readonly string[],
): Promise<void> => {
  const keys = deviceIds.flatMap((deviceId) =>
    Object.values(DEVICE_RATE_KEY_PREFIXES).map((prefix) => `${prefix}${deviceId}`),
  );
  if (keys.length === 0) {
    return;
  }
  await db.delete(rateLimit).where(inArray(rateLimit.key, keys));
};

// the unauthenticated routes, keyed on the caller's address: nothing else about the caller is
// known yet, and a login with no throttle is a password oracle
const CALLER_RATE_KEY_PREFIXES = {
  inviteSignUp: "invite-signup:",
  login: "device-login:",
} as const;

type CallerRateFamily = keyof typeof CALLER_RATE_KEY_PREFIXES;

// the one address Cloudflare's edge writes itself; x-forwarded-for carries whatever the caller put
// ahead of the edge's hop. Better Auth's limiter reads it too (./auth/auth.ts), so every window
// keyed on a caller names the same caller.
export const CALLER_IP_HEADER = "cf-connecting-ip";

export const callerRateKey = (family: CallerRateFamily, request: Request): string =>
  `${CALLER_RATE_KEY_PREFIXES[family]}${request.headers.get(CALLER_IP_HEADER) ?? "unknown"}`;

// every window the Worker spends, in one table so the guard reads each against AUTH_RATE_WINDOW_SECONDS
export const RATE_WINDOWS = {
  // low: a code is short enough to guess at volume, and Better Auth's limiter never sees a rejected invite
  inviteSignUp: { max: 10, windowMs: 60_000 },
  // per address, because nothing else about a caller who has not logged in is known
  login: { max: 10, windowMs: 60_000 },
  // set from the worst legitimate minute: 20 devices, every push pings the others, and a pinged
  // device syncs at once, so one device can owe ~100 requests; a ceiling near that refuses real sync
  vaultGit: { max: 600, windowMs: 60_000 },
  // the legitimate burst is one note's embeds, which the format does not bound; this breaks a
  // runaway loop, and a note past it sees its tail answered 429
  vaultRead: { max: 3000, windowMs: 60_000 },
} as const satisfies Record<CallerRateFamily | DeviceRateFamily, RateWindow>;
