import { sql } from "drizzle-orm";
import type { createDb } from "./db/client";
import { rateLimit } from "./db/schema";

// ---------------------------------------------------------------------------
// Fixed-window rate limiting over the shared `rate_limit` D1 table — the same
// table and the same shape Better Auth's own database limiter uses, so a route
// outside Better Auth gets the treatment the auth routes already have without
// a second store to reason about.
//
// TWO KINDS OF CALLER, and what each budget is FOR differs:
//
// - An UNAUTHENTICATED one, keyed on its address, where the window makes
//   guessing a code loud rather than carrying the entropy.
// - A VERIFIED DEVICE, keyed on the DEVICE, where the window bounds how fast
//   one credential can drain the account's vault. That is not the same as
//   preventing it, and the difference is worth stating: `/v1/git` hands a
//   whole vault over in a couple of requests, so what a budget buys there is
//   time — the dashboard's device list and its revoke button are the control,
//   and a rate that cannot outrun a person noticing is what makes them usable.
//   The per-file read paths are where it bites hardest: draining a vault
//   through them is one request per note.
//
// The kill switch lives HERE rather than at each call site, so "is the limiter
// on" has one answer.
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
  nowMs: number,
  window: RateWindow,
): Promise<boolean> {
  if (env.RATE_LIMIT_DISABLED === "true") {
    return true;
  }
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
