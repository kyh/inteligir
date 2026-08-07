// ---------------------------------------------------------------------------
// Per-account budgets for the HTTP leaves.
//
// WHERE THIS LIVES IS THE DESIGN. The auth routes are limited in D1 because
// their callers are anonymous and a shared store is the only place to count
// them. Every leaf here is the opposite: the caller has already proved a
// session, the Worker has already derived the one object that serves them, and
// that object has its own synchronous SQLite. So the ledger is local — no D1
// round trip, no second store, and no key to build, because THE OBJECT IS THE
// ACCOUNT. A limiter in the Worker would have cost two D1 operations per
// request to protect one, which is a limiter that pays for the attack.
//
// WHAT IT BOUNDS, honestly: the work each leaf does — R2 puts, R2 egress, a
// vault mutation, a mint. It does NOT bound the Durable Object wake that
// carried the request here, because the request is what woke it. That is a
// smaller gap than it sounds: a caller with no credential is refused in the
// Worker before any object is named, and a caller with one can only ever reach
// their own object, so the wake they can provoke is their own. The residue is
// one Better Auth session read per request, which no app-layer gate can remove
// — bounding that is an edge rule (WAF), not a table.
//
// FIXED windows, not sliding: `window_started` marks where a window opened and
// is only moved when a new one does. A burst at a boundary can therefore spend
// two windows' worth, which is the standard trade and is fine at budgets sized
// for a person rather than for a packet rate.
// ---------------------------------------------------------------------------

import type { HostLeaf } from "./host-route";

/** A budget: at most `max` requests per `windowMs`. */
type Budget = { readonly max: number; readonly windowMs: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * What each leaf costs, and therefore what it gets.
 *
 * - `ticket` is the cheapest and the most frequent: every connect and every
 *   reconnect mints one, and the bridge reconnects with backoff on a flaky
 *   network. It is one row in this object's own SQLite, so the budget is
 *   generous enough that a bad train journey never trips it.
 * - `assets` and `link` each commit a manifest row and R2 bytes — an editor
 *   paste and a captured line. Sized for a person pasting images or firing the
 *   scheme repeatedly, not for a bulk import (which is what the socket is for).
 * - `export` reads the WHOLE vault out of R2 and deflates it. It is the one
 *   leaf whose cost scales with the account's size rather than the request's,
 *   and the one a cross-site page can provoke without reading the result — so
 *   its budget is the tightest thing here and is stated in hours.
 */
const BUDGETS: Readonly<Record<HostLeaf, Budget>> = {
  ticket: { max: 240, windowMs: 5 * MINUTE },
  ws: { max: 240, windowMs: 5 * MINUTE },
  assets: { max: 120, windowMs: 5 * MINUTE },
  link: { max: 120, windowMs: 5 * MINUTE },
  export: { max: 5, windowMs: HOUR },
};

type WindowRow = { readonly count: number; readonly window_started: number };

export class HostLimits {
  private readonly sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    // Synchronous, so the table exists before the first request can charge it.
    // `host_` prefixed because this object's SQLite is shared with the vault
    // manifest, the knowledge index and the agent.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS host_rate_windows (
         leaf TEXT PRIMARY KEY,
         count INTEGER NOT NULL,
         window_started INTEGER NOT NULL
       )`,
    );
  }

  /**
   * Charge one unit of `leaf`'s budget; `false` once the window is spent.
   *
   * Synchronous, and that matters: the read and the write happen in one JS turn
   * over the object's own storage, so two concurrent requests cannot both read
   * the same count and both write count + 1.
   */
  charge(leaf: HostLeaf, now: number): boolean {
    const budget = BUDGETS[leaf];
    const row = this.sql
      .exec<WindowRow>("SELECT count, window_started FROM host_rate_windows WHERE leaf = ?", leaf)
      .toArray()[0];
    if (row === undefined || now - row.window_started > budget.windowMs) {
      this.sql.exec(
        `INSERT INTO host_rate_windows (leaf, count, window_started) VALUES (?, 1, ?)
         ON CONFLICT(leaf) DO UPDATE SET count = 1, window_started = excluded.window_started`,
        leaf,
        now,
      );
      return true;
    }
    if (row.count >= budget.max) return false;
    this.sql.exec("UPDATE host_rate_windows SET count = count + 1 WHERE leaf = ?", leaf);
    return true;
  }

  /** Seconds until `leaf`'s window reopens — what a 429 tells the caller to
   * wait, so a client backs off by the real amount rather than by a guess. */
  retryAfterSeconds(leaf: HostLeaf, now: number): number {
    const budget = BUDGETS[leaf];
    const row = this.sql
      .exec<WindowRow>("SELECT count, window_started FROM host_rate_windows WHERE leaf = ?", leaf)
      .toArray()[0];
    if (row === undefined) return 0;
    return Math.max(1, Math.ceil((row.window_started + budget.windowMs - now) / 1000));
  }
}
