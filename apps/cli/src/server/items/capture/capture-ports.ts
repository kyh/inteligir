// what a suite injects into the capture through `ComposePorts.items`: compose passes it through
// untouched. Each override replaces one seam the real server builds itself: the whole fetch, or
// only its resolver and its classification of addresses; the fill worker; and the clock the
// pending fills are scheduled by. No env var reaches any of them.

import type { AddressPolicy } from "./address-guard";
import type { FillRunner } from "./fill-runner";
import type { GuardedFetch, HostLookup } from "./guarded-fetch";

export interface CaptureClock {
  now: () => number;
  // runs `run` once after `ms`; the answer cancels it
  setTimer: (ms: number, run: () => void) => () => void;
}

export interface CapturePorts {
  fetcher?: GuardedFetch | undefined;
  lookup?: HostLookup | undefined;
  policy?: AddressPolicy | undefined;
  runner?: FillRunner | undefined;
  clock?: CaptureClock | undefined;
}

// a 32-bit timer's ceiling; a later wake re-arms from there
const TIMER_MAX_MS = 2_147_483_647;

export const systemClock: CaptureClock = {
  now: () => Date.now(),
  setTimer: (ms, run) => {
    const timer = setTimeout(run, Math.min(Math.max(0, ms), TIMER_MAX_MS));
    timer.unref();
    return () => {
      clearTimeout(timer);
    };
  },
};
