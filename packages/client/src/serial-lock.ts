type SerialLock = <T>(task: () => Promise<T>) => Promise<T>;

export const serialLock = () => {
  let tail: Promise<unknown> = Promise.resolve();

  return (async <T>(task: () => Promise<T>) => {
    const previous = tail;

    const next = (async () => {
      await Promise.allSettled([previous]);

      return await task();
    })();

    tail = next;

    return await next;
  }) satisfies SerialLock;
};
