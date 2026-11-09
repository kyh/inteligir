// A clock the suites move by hand: `now` stands still until `advance` moves it, running each timer
// that comes due on the way, in the order they come due.

import type { Clock } from "../library/account-socket";

interface Timer {
  readonly at: number;
  readonly order: number;
  readonly run: () => void;
}

/** @internal */
export interface FakeClock extends Clock {
  readonly advance: (ms: number) => void;
  // the timers still waiting
  readonly pending: () => number;
}

/** @internal */
export const fakeClock = (start = 1_700_000_000_000): FakeClock => {
  let now = start;
  let order = 0;
  const timers = new Set<Timer>();
  return {
    advance: (ms) => {
      const until = now + ms;
      for (;;) {
        const [next] = [...timers].toSorted((a, b) => a.at - b.at || a.order - b.order);
        if (next === undefined || next.at > until) {
          break;
        }
        timers.delete(next);
        now = next.at;
        next.run();
      }
      now = until;
    },
    after: (ms, run) => {
      order += 1;
      const timer: Timer = { at: now + ms, order, run };
      timers.add(timer);
      return () => {
        timers.delete(timer);
      };
    },
    now: () => now,
    pending: () => timers.size,
  };
};
