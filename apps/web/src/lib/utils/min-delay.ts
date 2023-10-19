export const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export const minDelay = async <T>(promise: Promise<T>, ms: number) => {
  const [p] = await Promise.all([promise, sleep(ms)]);

  return p;
};
