import { db } from "@repo/db/drizzle-client";
import { rateLimit } from "@repo/db/auth-schema";
import { sql } from "drizzle-orm";

import { clientAddressOf } from "./auth/client-ip";
import { env } from "./env";

// Fixed windows over Better Auth's own rate_limit table, which Better Auth prunes on its own writes:
// a row whose last request is older than its longest window goes, the app's included. A caller not
// signed in is keyed on its address, the one thing known of it yet; a signed one on what it holds,
// its session, its account or its assistant's grant. A sign-in is Better Auth's route, under its
// own limiter (./auth/auth.ts).

interface RateWindow {
  readonly max: number;
  readonly windowMs: number;
}

// Better Auth's own window (./auth/auth.ts), in its unit. A row here keeps its window's start as its
// last request, so a window no longer than this is pruned only after it lapsed; a longer one would
// lose its count mid-window, which the window guard in auth-rate-limit.test.ts refuses.
export const AUTH_RATE_WINDOW_SECONDS = 60;

const CALLER_RATE_KEY_PREFIXES = {
  inviteSignUp: "invite-signup:",
} as const;

const HOLDER_RATE_KEY_PREFIXES = {
  accountDelete: "account-delete:",
  connectorCall: "connector-call:",
  fileRead: "file-read:",
  fileReserve: "file-reserve:",
  rpcCall: "rpc-call:",
} as const;

type CallerRateFamily = keyof typeof CALLER_RATE_KEY_PREFIXES;
export type HolderRateFamily = keyof typeof HOLDER_RATE_KEY_PREFIXES;

export const RATE_WINDOWS = {
  // a password check behind a session, so a stolen one guesses here rather than at the sign-in's
  // per-address window; a person mistypes a few times, never dozens
  accountDelete: { max: 5, windowMs: 60_000 },
  // each call a connected assistant makes, keyed on its grant: a turn makes a few dozen
  connectorCall: { max: 300, windowMs: 60_000 },
  // each read of a file, keyed on the session: a video seeking reads a range at a time, and a grid
  // of pictures one each, so it sits past what `/v1` calls take
  fileRead: { max: 3000, windowMs: 60_000 },
  // each upload a library reserves, keyed on the account: a folder dropped at once reserves a file
  // each, and each reserve costs a request of the store's
  fileReserve: { max: 3000, windowMs: 60_000 },
  // low: a code is short enough to guess at volume, and Better Auth's limiter never sees a refused
  // invite
  inviteSignUp: { max: 10, windowMs: 60_000 },
  // each signed /v1 call, keyed on the session: past what a person makes, a phone back online
  // landing its saves a call each included, so only a loop meets it
  rpcCall: { max: 1200, windowMs: 60_000 },
} as const satisfies Record<CallerRateFamily | HolderRateFamily, RateWindow>;

export const callerRateKey = (family: CallerRateFamily, request: Request): string =>
  `${CALLER_RATE_KEY_PREFIXES[family]}${clientAddressOf(request) ?? "unknown"}`;

// a row with no foreign key: a session that lapses announces nothing, so its window waits for
// Better Auth's prune
export const holderRateKey = (family: HolderRateFamily, holderId: string): string =>
  `${HOLDER_RATE_KEY_PREFIXES[family]}${holderId}`;

// what a spend met: room in its window, or a window spent, and the whole seconds until the next
// opens, which a refusal names as its `retry-after`
type BudgetSpend =
  | { readonly kind: "allowed" }
  | { readonly kind: "refused"; readonly retryAfterSeconds: number };

const ALLOWED: BudgetSpend = { kind: "allowed" };

// one upsert: a read-then-write limiter lets N concurrent requests read one count and all pass, so
// the count is read from the write itself
const allowInWindow = async (key: string, window: RateWindow): Promise<BudgetSpend> => {
  if (env.RATE_LIMIT_DISABLED) {
    return ALLOWED;
  }
  const nowMs = Date.now();
  const lapsed = sql`${nowMs} - ${rateLimit.lastRequest} > ${window.windowMs}`;
  const [settled] = await db
    .insert(rateLimit)
    .values({ count: 1, id: crypto.randomUUID(), key, lastRequest: nowMs })
    .onConflictDoUpdate({
      set: {
        count: sql`case when ${lapsed} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: sql`case when ${lapsed} then ${nowMs} else ${rateLimit.lastRequest} end`,
      },
      target: rateLimit.key,
    })
    .returning({ count: rateLimit.count, opened: rateLimit.lastRequest });
  // the count climbs past max inside a spent window and resets when the next opens
  if (settled === undefined || settled.count <= window.max) {
    return ALLOWED;
  }
  // the window shuts through its last millisecond, so the next opens the one after
  const untilOpen = settled.opened + window.windowMs + 1 - nowMs;
  return { kind: "refused", retryAfterSeconds: Math.max(1, Math.ceil(untilOpen / 1000)) };
};

export const spendCallerBudget = async (
  family: CallerRateFamily,
  request: Request,
): Promise<BudgetSpend> =>
  await allowInWindow(callerRateKey(family, request), RATE_WINDOWS[family]);

export const spendHolderBudget = async (
  family: HolderRateFamily,
  holderId: string,
): Promise<BudgetSpend> =>
  await allowInWindow(holderRateKey(family, holderId), RATE_WINDOWS[family]);
