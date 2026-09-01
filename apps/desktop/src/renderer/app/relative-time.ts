// "How long ago", once, for the whole window.
//
// EPOCH MILLISECONDS, AND `now` PASSED IN. A surface that grows its own ladder
// disagrees with its neighbours on tiers, casing and rounding, and a reader
// cannot tell a wording difference from a difference in age. The UNIT is the
// dangerous half: a helper over unix seconds and one over epoch ms look
// identical at every call site, and neither the types nor the wire distinguish
// them, so a value carried between them is three orders of magnitude wrong
// with no compile error. A caller whose value speaks seconds converts at its
// own boundary.

import { useEffect, useState } from "react";

export interface RelativeTimeOptions {
  /** Render a sub-minute gap as `40s ago` rather than "Just now" — for a
   *  surface whose whole claim is freshness (the sync row renders right beside
   *  the button that refreshes it). */
  seconds?: boolean;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export function relativeTimeLabel(
  atMs: number,
  nowMs: number,
  options?: RelativeTimeOptions,
): string {
  // A clock that ran backwards (a synced timestamp from a device ahead of this
  // one) reads as "now" rather than as a negative age.
  const elapsed = Math.max(0, nowMs - atMs);
  if (elapsed < MINUTE_MS) {
    return options?.seconds === true ? `${String(Math.floor(elapsed / 1000))}s ago` : "Just now";
  }
  if (elapsed < HOUR_MS) return `${String(Math.floor(elapsed / MINUTE_MS))}m ago`;
  if (elapsed < DAY_MS) return `${String(Math.floor(elapsed / HOUR_MS))}h ago`;
  if (elapsed < WEEK_MS) return `${String(Math.floor(elapsed / DAY_MS))}d ago`;
  return new Date(atMs).toLocaleDateString();
}

/** A minute is the finest tier `relativeTimeLabel` distinguishes above "Just
 *  now", so it is the default cadence; a surface rendering the seconds tier
 *  passes a tick to match. */
const CLOCK_TICK_MS = 60_000;

/** The clock these labels read. A `Date.now()` during render is an impure read
 *  — the age shown is whatever the last unrelated re-render happened to catch
 *  — so the clock is state, advanced on its own tick. */
export function useNow(tickMs: number = CLOCK_TICK_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
    }, tickMs);
    return () => {
      clearInterval(tick);
    };
  }, [tickMs]);
  return now;
}
