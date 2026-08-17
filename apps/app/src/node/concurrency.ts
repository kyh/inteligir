/**
 * Run `work` over `items` with at most `limit` in flight, resolving to the
 * results IN INPUT ORDER — so a caller can gather async reads in parallel and
 * still apply them as one ordered synchronous batch. A rejection propagates
 * once every already-started unit has settled.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (index >= items.length || item === undefined) {
        return;
      }
      results[index] = await work(item, index);
    }
  });
  await Promise.all(runners);
  return results;
}
