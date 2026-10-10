// on storage that fetches or wakes (an on-demand placeholder, a sleeping disk, a network mount) an
// open can block for minutes, and while it does it holds one of node's four fs threads. a fourth
// stalls every fs call in the process, the saves included, which no deadline can free. so at most
// three vault files are open for reading at once, whoever asked.
export const READ_SLOTS = 3;

// a background read is one of many a single job makes (an index pass, a rename's snapshot, a
// delete's id scan, the boot's backfill), and on such storage every one of them may stall. it
// never takes the last slot, so a read the window waits on still opens while two of them hang,
// rather than queueing behind them or answering that a note on disk is unavailable.
export const BACKGROUND_READ_SLOTS = 2;

export type ReadLane = "foreground" | "background";

export interface ReadSlots {
  // `open` runs once its lane has a slot, and holds it until it settles. a freed slot goes to a
  // waiting foreground read first.
  hold: <T>(lane: ReadLane, open: () => Promise<T>) => Promise<T>;
}

export const createReadSlots = (): ReadSlots => {
  const held: Record<ReadLane, number> = { background: 0, foreground: 0 };
  const waiting: Record<ReadLane, (() => void)[]> = { background: [], foreground: [] };

  const fits = (lane: ReadLane): boolean =>
    held.background + held.foreground < READ_SLOTS &&
    (lane === "foreground" || held.background < BACKGROUND_READ_SLOTS);

  // a slot is counted as held before its waiter wakes, so no acquire in between can take it.
  const admitWaiting = (): void => {
    for (const lane of ["foreground", "background"] as const) {
      while (fits(lane)) {
        const admit = waiting[lane].shift();
        if (admit === undefined) {
          break;
        }
        held[lane] += 1;
        admit();
      }
    }
  };

  // every release admits what fits, so a lane with waiters never fits a newcomer ahead of them.
  const acquire = async (lane: ReadLane): Promise<void> => {
    if (fits(lane)) {
      held[lane] += 1;
      return;
    }
    const admitted = Promise.withResolvers<null>();
    waiting[lane].push(() => {
      admitted.resolve(null);
    });
    await admitted.promise;
  };

  return {
    async hold(lane, open) {
      await acquire(lane);
      try {
        return await open();
      } finally {
        held[lane] -= 1;
        admitWaiting();
      }
    },
  };
};
