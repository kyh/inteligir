// A leave's ask of the note page, and its answer. Each ask is the next count, which the page sees in
// its `settle` prop and answers by count, so a late answer to an earlier ask settles nothing. A page
// that does not answer in time counts as not holding, since an edit it never sent would go with it.

import type { Clock } from "@repo/contract/library/account-socket";
import type { Settled } from "./page/page-host";

/** @internal */
export const SETTLE_ANSWER_MS = 5000;

export interface LeaveAsks {
  // `then` hears whether the note holds every edit made here, once
  readonly ask: (then: (holds: boolean) => void) => void;
  readonly answer: (settled: Settled) => void;
}

export interface LeaveAsksArgs {
  // the page is handed this count as its `settle`
  readonly asked: (count: number) => void;
  readonly clock: Pick<Clock, "after">;
}

export const leaveAsks = ({ asked, clock }: LeaveAsksArgs): LeaveAsks => {
  let count = 0;
  const waiting = new Map<number, (holds: boolean) => void>();
  return {
    answer: ({ ask, holds }) => {
      waiting.get(ask)?.(holds);
    },
    ask: (then) => {
      count += 1;
      const mine = count;
      const stop = clock.after(SETTLE_ANSWER_MS, () => {
        waiting.delete(mine);
        then(false);
      });
      waiting.set(mine, (holds) => {
        stop();
        waiting.delete(mine);
        then(holds);
      });
      asked(mine);
    },
  };
};
