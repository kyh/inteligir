import { getIP } from "better-auth/api";
import { inArray, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { rateLimit } from "./db/schema";

// Fixed windows over Better Auth's own rate_limit table, which Better Auth prunes on its own
// writes: a row whose last request is older than its longest window goes, the Worker's included.
// Unauthenticated callers are keyed on their address, `/v1`'s holders on the device or browser
// session that signed in, and an assistant on its grant; the kill switch is read here, not per
// caller.

/** @internal */
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
const allowInWindow = async (
  env: Env,
  db: Db,
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

// what `holderIdOf` keys: named here because eviction must spend the same spellings the routes do;
// the table has no foreign key
const HOLDER_RATE_KEY_PREFIXES = {
  accountDelete: "account-delete:",
  blobs: "blobs:",
  rpc: "rpc:",
} as const;

type HolderRateFamily = keyof typeof HOLDER_RATE_KEY_PREFIXES;

/** @internal */
export const holderRateKey = (family: HolderRateFamily, holderId: string): string =>
  `${HOLDER_RATE_KEY_PREFIXES[family]}${holderId}`;

/** @internal */
export const grantRateKey = (grantId: string): string => `connector:${grantId}`;

// Better Auth's prune reaches a row only after its window lapsed, and only when one of Better
// Auth's own windows rolls over; a revoked device's budget names nobody, so it goes at once. A
// session's and a grant's wait for the prune: a session also ends by lapsing, which nothing
// announces, and a revoked grant's token may answer for a minute more and write its row again
export const forgetDeviceBudgets = async (db: Db, deviceIds: readonly string[]): Promise<void> => {
  const keys = deviceIds.flatMap((deviceId) =>
    Object.values(HOLDER_RATE_KEY_PREFIXES).map((prefix) => `${prefix}${deviceId}`),
  );
  if (keys.length === 0) {
    return;
  }
  await db.delete(rateLimit).where(inArray(rateLimit.key, keys));
};

// the unauthenticated routes, keyed on the caller's address: nothing else about the caller is
// known yet, a login with no throttle is a password oracle, and a registration with none fills KV
const CALLER_RATE_KEY_PREFIXES = {
  clientRegistration: "client-registration:",
  inviteSignUp: "invite-signup:",
  login: "device-login:",
} as const;

type CallerRateFamily = keyof typeof CALLER_RATE_KEY_PREFIXES;

// the one address Cloudflare's edge writes itself; x-forwarded-for carries whatever the caller put
// ahead of the edge's hop
/** @internal */
export const CALLER_IP_HEADER = "cf-connecting-ip";

// how a caller is told from a request here and in Better Auth's limiter (./auth/auth.ts), so every
// window names the same caller: `getIP` masks an IPv6 address to its /64, which one host holds
// whole and could otherwise walk for a fresh window on every request
export const CALLER_ADDRESS = { ipAddressHeaders: [CALLER_IP_HEADER] };

/** @internal */
export const callerRateKey = (family: CallerRateFamily, request: Request): string =>
  `${CALLER_RATE_KEY_PREFIXES[family]}${getIP(request, { advanced: { ipAddress: CALLER_ADDRESS } }) ?? "unknown"}`;

// every window the Worker spends, in one table so the guard reads each against AUTH_RATE_WINDOW_SECONDS
/** @internal */
export const RATE_WINDOWS = {
  // a password check behind a device credential, so a stolen one guesses here rather than at
  // login's per-address window; a person mistypes a few times, never dozens
  accountDelete: { max: 5, windowMs: 60_000 },
  // an assistant registering itself with the connector's OAuth: each one is a client record KV
  // keeps 90 days, and a person connects an assistant or two at a time, never dozens a minute
  clientRegistration: { max: 10, windowMs: 60_000 },
  // low: a code is short enough to guess at volume, and Better Auth's limiter never sees a rejected invite
  inviteSignUp: { max: 10, windowMs: 60_000 },
  login: { max: 10, windowMs: 60_000 },
  // a library's files, read and written: a grid of covers and a video read range by range are the
  // legitimate bursts
  blobs: { max: 3000, windowMs: 60_000 },
  // every call a connected assistant makes on the connector, keyed on its grant: a turn reads and
  // edits a few dozen times, and a client listing and calling its tools in a loop is no person's
  connector: { max: 300, windowMs: 60_000 },
  // every signed call on /v1/rpc, keyed on the device or the browser session: a screen reads its
  // pages again on each socket frame, and a phone back online lands its waiting saves a write a
  // call, which a few hundred calls cover, so a ceiling past that is a loop
  rpc: { max: 1200, windowMs: 60_000 },
} as const satisfies Record<CallerRateFamily | HolderRateFamily | "connector", RateWindow>;

export const spendCallerBudget = async (
  env: Env,
  db: Db,
  family: CallerRateFamily,
  request: Request,
): Promise<boolean> =>
  await allowInWindow(env, db, callerRateKey(family, request), RATE_WINDOWS[family]);

export const spendHolderBudget = async (
  env: Env,
  db: Db,
  family: HolderRateFamily,
  holderId: string,
): Promise<boolean> =>
  await allowInWindow(env, db, holderRateKey(family, holderId), RATE_WINDOWS[family]);

export const spendGrantBudget = async (env: Env, db: Db, grantId: string): Promise<boolean> =>
  await allowInWindow(env, db, grantRateKey(grantId), RATE_WINDOWS.connector);
