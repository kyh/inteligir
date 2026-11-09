import type { Clock } from "@repo/contract/library/account-socket";

export const pageClock: Clock = {
  after: (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => {
      clearTimeout(timer);
    };
  },
  now: () => Date.now(),
};
