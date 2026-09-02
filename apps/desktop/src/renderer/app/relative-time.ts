// Epoch milliseconds only. A caller holding unix seconds converts at its own
// boundary: nothing in the types distinguishes the two units.

import { useEffect, useState } from "react";

export interface RelativeTimeOptions {
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
  // A synced timestamp from a device whose clock is ahead reads as "now".
  const elapsed = Math.max(0, nowMs - atMs);
  if (elapsed < MINUTE_MS) {
    return options?.seconds === true ? `${String(Math.floor(elapsed / 1000))}s ago` : "Just now";
  }
  if (elapsed < HOUR_MS) return `${String(Math.floor(elapsed / MINUTE_MS))}m ago`;
  if (elapsed < DAY_MS) return `${String(Math.floor(elapsed / HOUR_MS))}h ago`;
  if (elapsed < WEEK_MS) return `${String(Math.floor(elapsed / DAY_MS))}d ago`;
  return new Date(atMs).toLocaleDateString();
}

const CLOCK_TICK_MS = 60_000;

// Not `Date.now()` in render: the age shown would be whatever the last
// unrelated re-render caught.
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
