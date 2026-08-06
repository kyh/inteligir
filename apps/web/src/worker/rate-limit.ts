import { eq } from "drizzle-orm";
import type { createDb } from "./db/client";
import { rateLimit } from "./db/schema";

// ---------------------------------------------------------------------------
// Fixed-window rate limiting over the shared `rate_limit` D1 table — the same
// table and the same shape Better Auth's own database limiter uses, so a
// credential-free route gets the treatment the auth routes already have without
// a second store to reason about.
//
// The callers are the two surfaces that take input from an UNAUTHENTICATED
// caller: `/v1/auth/exchange` (guessable codes) and `/v1/vault/:id/enroll`
// (the offer secret is the auth, and the route names a Durable Object).
// ---------------------------------------------------------------------------

/** A budget: at most `max` requests per `windowMs`, per key. */
export type RateWindow = { readonly max: number; readonly windowMs: number };

/**
 * Consume one unit of `key`'s budget; false once the window's budget is spent.
 * The window is fixed rather than sliding — `lastRequest` marks where it opened
 * and is only rewritten when a new one does.
 */
export async function allowInWindow(
  db: ReturnType<typeof createDb>,
  key: string,
  nowMs: number,
  window: RateWindow,
): Promise<boolean> {
  const row = await db.select().from(rateLimit).where(eq(rateLimit.key, key)).get();
  if (row === undefined) {
    await db
      .insert(rateLimit)
      .values({ id: crypto.randomUUID(), key, count: 1, lastRequest: nowMs })
      .onConflictDoNothing();
    return true;
  }
  if (nowMs - row.lastRequest > window.windowMs) {
    await db.update(rateLimit).set({ count: 1, lastRequest: nowMs }).where(eq(rateLimit.key, key));
    return true;
  }
  if (row.count >= window.max) return false;
  await db
    .update(rateLimit)
    .set({ count: row.count + 1 })
    .where(eq(rateLimit.key, key));
  return true;
}

/** The client IP a limiter keys on, or a shared bucket when the edge sent none. */
export function callerIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}
