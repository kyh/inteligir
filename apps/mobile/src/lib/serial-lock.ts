// A queue of one: each task starts once the one before it has settled, whichever way it settled,
// and its caller hears its own outcome.

export type SerialLock = <T>(task: () => Promise<T>) => Promise<T>;

export const serialLock = (): SerialLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return async <T>(task: () => Promise<T>): Promise<T> => {
    const previous = tail;
    const next = (async () => {
      try {
        await previous;
      } catch {
        // that task's caller heard its failure; this one only waited for it to end
      }
      return await task();
    })();
    tail = next;
    return await next;
  };
};
