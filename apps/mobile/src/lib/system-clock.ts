// The contract's clock over the platform's own timers, which the runtime and every note page run on.

import type { Clock } from "@repo/contract/library/account-socket";

export const systemClock: Clock = {
  after: (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => {
      clearTimeout(timer);
    };
  },
  now: () => Date.now(),
};
