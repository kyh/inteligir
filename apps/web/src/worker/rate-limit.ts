import { sql } from "drizzle-orm";
import type { createDb } from "./db/client";
import { rateLimit } from "./db/schema";

// ---------------------------------------------------------------------------
// Fixed-window rate limiting over the shared `rate_limit` D1 table — the same
// table and the same shape Better Auth's own database limiter uses, so a
// credential-free route gets the treatment the auth routes already have without
// a second store to reason about.
//
// It guards the routes that take input from an UNAUTHENTICATED caller and
// decide something durable from it.
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
  db: ReturnType<typeof createDb>,
  key: string,
  nowMs: number,
  window: RateWindow,
): Promise<boolean> {
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

/** The client IP a limiter keys on, or a shared bucket when the edge sent none. */
export function callerIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}
