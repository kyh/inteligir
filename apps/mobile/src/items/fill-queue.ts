// The links this phone saved and has not read yet, and when it reads them: a save at once, one link
// at a time, while the phone is signed in, online and the app is open. A failure a later try may get
// past waits 1, 10 and 60 minutes, as the Mac's does, and the fourth is said in the file. The rows
// are the store's (phone-db's `pending_fills`), written in the transaction that queues the stub, so
// a save made offline, or one the app was closed before reading, is read the next time the app is
// open and online. Platform-free: the suite drives it with a clock of its own.

import type { NotesStore, PendingFill } from "../notes/notes-store";
import type { LinkFillOutcome } from "./link-fill";

const MINUTE = 60_000;
const RETRY_AFTER_MS = [MINUTE, 10 * MINUTE, 60 * MINUTE];

export interface FillQueueArgs {
  store: Pick<NotesStore, "pendingFills">;
  // one fill; `mayRetry` false says a transient failure in the file rather than trying again
  fill: (row: PendingFill, mayRetry: boolean) => Promise<LinkFillOutcome>;
  // whether a fill may run now: signed in and online
  canFill: () => boolean;
  now: () => number;
  // a timer the queue cancels; the app's is setTimeout's
  setTimer: (ms: number, run: () => void) => () => void;
}

export interface FillQueue {
  // a save was just made, or the app is open again or back online: read what is due
  wake: () => void;
  // the app left the foreground: no timer runs until it wakes again
  suspend: () => void;
  // resolves once no due row is left unread, or a fill may not run now
  settled: () => Promise<void>;
}

export const createFillQueue = (args: FillQueueArgs): FillQueue => {
  let running: Promise<void> | null = null;
  let again = false;
  let suspended = false;
  let cancelTimer: (() => void) | null = null;

  const settle = async (row: PendingFill, outcome: LinkFillOutcome): Promise<void> => {
    if (outcome.kind !== "retry") {
      await args.store.pendingFills.remove(row.itemId);
      return;
    }
    const attempts = row.attempts + 1;
    const wait = RETRY_AFTER_MS[attempts - 1] ?? RETRY_AFTER_MS.at(-1) ?? MINUTE;
    await args.store.pendingFills.update({ ...row, attempts, notBefore: args.now() + wait });
  };

  const fillOne = async (row: PendingFill): Promise<void> => {
    let outcome: LinkFillOutcome;
    try {
      outcome = await args.fill(row, row.attempts < RETRY_AFTER_MS.length);
    } catch {
      // the reader went away or the store refused: tried again on the same schedule
      outcome = { kind: "retry" };
    }
    await settle(row, outcome);
  };

  // the next row to come due, armed as a timer unless the app is away
  const arm = (rows: readonly PendingFill[], then: () => void): void => {
    cancelTimer?.();
    cancelTimer = null;
    const next = Math.min(...rows.map((row) => row.notBefore));
    if (suspended || !Number.isFinite(next)) {
      return;
    }
    cancelTimer = args.setTimer(Math.max(0, next - args.now()), () => {
      cancelTimer = null;
      then();
    });
  };

  // every due row, oldest first, then the timer for the rest
  const pass = async (then: () => void): Promise<void> => {
    for (;;) {
      if (!args.canFill()) {
        return;
      }
      const rows = await args.store.pendingFills.list();
      const due = rows.find((row) => row.notBefore <= args.now());
      if (due === undefined) {
        arm(rows, then);
        return;
      }
      await fillOne(due);
    }
  };

  const run = async (then: () => void): Promise<void> => {
    do {
      again = false;
      try {
        await pass(then);
      } catch {
        // the rows could not be read; the next wake reads them again
      }
    } while (again);
  };

  const wake = (): void => {
    suspended = false;
    if (running !== null) {
      again = true;
      return;
    }
    running = (async () => {
      try {
        await run(wake);
      } finally {
        running = null;
      }
    })();
  };

  return {
    async settled() {
      wake();
      for (let current = running; current !== null; current = running) {
        await current;
      }
    },
    suspend() {
      suspended = true;
      cancelTimer?.();
      cancelTimer = null;
    },
    wake,
  };
};
