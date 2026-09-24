// a read that has not answered by its deadline is left running rather than awaited: the pass that
// asked moves on, and what the read answers lands later. a read left running still counts against
// the limit, because a stalled open holds one of node's four fs threads until the storage answers,
// and the fourth stalls every fs call in the process. once every slot is held by a read nobody
// awaits, the rest of the batch is queued, never opened, and the queue is read as reads land.

import { setTimeout as delay } from "node:timers/promises";

export interface DeferredReadsArgs<T> {
  // answers every outcome of the read as a value; a rejection fails the pass that awaited it
  read: (path: string) => Promise<T>;
  // reads out at once, awaited or not
  limit: number;
  deadlineMs: number;
  // something landed: the caller runs a pass to take it
  onLanded: () => void;
}

export interface DeferredReads<T> {
  // an answer per path, in order, or null where the read was left running or queued: that one
  // lands through `takeLanded`
  readAll: (paths: readonly string[]) => Promise<(T | null)[]>;
  takeLanded: () => Map<string, T>;
  // the path and everything under it changed: drop what is queued or landed for it, and read
  // again whatever is still out once that lands
  forget: (path: string) => void;
  dispose: () => void;
}

interface Unawaited {
  // asked for or forgotten while out, so what it lands may predate what the caller wants
  stale: boolean;
}

export const createDeferredReads = <T>(args: DeferredReadsArgs<T>): DeferredReads<T> => {
  let out = 0;
  let disposed = false;
  const unawaited = new Map<string, Unawaited>();
  // a stack, so the latest path deferred is read first: an announced change is never read behind
  // a whole reconcile's backlog. a forgotten path stays on it and is skipped when popped.
  const stack: string[] = [];
  const queued = new Set<string>();
  const landed = new Map<string, T>();

  // the count drops before the answer reaches anyone, so the reader it wakes can take the slot
  const start = async (path: string): Promise<T> => {
    out += 1;
    try {
      return await args.read(path);
    } finally {
      out -= 1;
    }
  };

  const enqueue = (path: string): void => {
    if (!queued.has(path)) {
      queued.add(path);
      stack.push(path);
    }
  };

  const takeQueued = (): string | null => {
    if (disposed || out >= args.limit) {
      return null;
    }
    for (let path = stack.pop(); path !== undefined; path = stack.pop()) {
      if (queued.delete(path)) {
        return path;
      }
    }
    return null;
  };

  const leaveRunning = (path: string, reading: Promise<T>): void => {
    const entry: Unawaited = { stale: false };
    unawaited.set(path, entry);
    void (async () => {
      let answer: { value: T } | null = null;
      try {
        answer = { value: await reading };
      } catch {
        // `read` answers every outcome, so this is a fault no pass awaited: the next pass that
        // asks for the path reads it again.
      }
      unawaited.delete(path);
      if (disposed) {
        return;
      }
      if (answer !== null && entry.stale) {
        enqueue(path);
      } else if (answer !== null) {
        landed.set(path, answer.value);
        args.onLanded();
      }
      for (let next = takeQueued(); next !== null; next = takeQueued()) {
        leaveRunning(next, start(next));
      }
    })();
  };

  // false when the path's read is already out: a second open would only wait on the same storage
  const claim = (path: string): boolean => {
    const outstanding = unawaited.get(path);
    if (outstanding !== undefined) {
      outstanding.stale = true;
      return false;
    }
    landed.delete(path);
    queued.delete(path);
    return true;
  };

  const readWithinDeadline = async (path: string): Promise<T | null> => {
    const reading = start(path);
    const deadline = new AbortController();
    try {
      const answered = await Promise.race([
        reading.then((answer) => ({ answer })),
        delay(args.deadlineMs, null, { signal: deadline.signal }),
      ]);
      if (answered !== null) {
        return answered.answer;
      }
    } finally {
      deadline.abort();
    }
    leaveRunning(path, reading);
    return null;
  };

  return {
    dispose() {
      disposed = true;
      stack.length = 0;
      queued.clear();
      landed.clear();
    },

    forget(path) {
      const under = (candidate: string): boolean =>
        candidate === path || candidate.startsWith(`${path}/`);
      for (const [candidate, entry] of unawaited) {
        if (under(candidate)) {
          entry.stale = true;
        }
      }
      for (const candidate of queued) {
        if (under(candidate)) {
          queued.delete(candidate);
        }
      }
      for (const candidate of landed.keys()) {
        if (under(candidate)) {
          landed.delete(candidate);
        }
      }
    },

    // a runner stops at a full budget rather than queueing, since the slot it waits for may be a
    // sibling's; only the last one out, with every slot held by a read nobody awaits, queues the rest
    async readAll(paths) {
      const answers: (T | null)[] = paths.map(() => null);
      let next = 0;
      let running = args.limit;
      const runner = async (): Promise<void> => {
        while (next < paths.length && out < args.limit) {
          const index = next;
          next += 1;
          const path = paths[index];
          if (path !== undefined && claim(path)) {
            answers[index] = await readWithinDeadline(path);
          }
        }
        running -= 1;
        if (running > 0) {
          return;
        }
        for (const path of paths.slice(next)) {
          if (claim(path)) {
            enqueue(path);
          }
        }
        next = paths.length;
      };
      await Promise.all(Array.from({ length: args.limit }, runner));
      return answers;
    },

    takeLanded() {
      const taken = new Map(landed);
      landed.clear();
      return taken;
    },
  };
};
