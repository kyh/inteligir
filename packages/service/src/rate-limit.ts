import { db } from "@repo/db/drizzle-client";
import { rateLimit } from "@repo/db/auth-schema";
import { sql } from "drizzle-orm";

import { clientAddressOf } from "./client-ip";
import { env } from "./env";

interface RateWindow {
  readonly max: number;
  readonly windowMs: number;
}

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
  accountDelete: { max: 5, windowMs: 60_000 },
  connectorCall: { max: 300, windowMs: 60_000 },
  fileRead: { max: 3000, windowMs: 60_000 },
  fileReserve: { max: 3000, windowMs: 60_000 },
  inviteSignUp: { max: 10, windowMs: 60_000 },
  rpcCall: { max: 1200, windowMs: 60_000 },
} as const satisfies Record<CallerRateFamily | HolderRateFamily, RateWindow>;

export const callerRateKey = (family: CallerRateFamily, request: Request) =>
  `${CALLER_RATE_KEY_PREFIXES[family]}${clientAddressOf(request) ?? "unknown"}`;

export const holderRateKey = (family: HolderRateFamily, holderId: string) =>
  `${HOLDER_RATE_KEY_PREFIXES[family]}${holderId}`;

type BudgetSpend =
  | { readonly kind: "allowed" }
  | { readonly kind: "refused"; readonly retryAfterSeconds: number };

const ALLOWED: BudgetSpend = { kind: "allowed" };

const allowInWindow = async (key: string, window: RateWindow) => {
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

  if (settled === undefined || settled.count <= window.max) {
    return ALLOWED;
  }

  const untilOpen = settled.opened + window.windowMs + 1 - nowMs;

  return {
    kind: "refused",
    retryAfterSeconds: Math.max(1, Math.ceil(untilOpen / 1000)),
  } satisfies BudgetSpend;
};

export const spendCallerBudget = async (family: CallerRateFamily, request: Request) =>
  await allowInWindow(callerRateKey(family, request), RATE_WINDOWS[family]);

export const spendHolderBudget = async (family: HolderRateFamily, holderId: string) =>
  await allowInWindow(holderRateKey(family, holderId), RATE_WINDOWS[family]);
