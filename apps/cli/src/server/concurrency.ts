// results are in input order. the first rejection starts nothing new and is rethrown once every
// started unit has settled, so no unit outlives the call.
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = Array.from({ length: items.length });
  // shared, so each index is taken by exactly one runner.
  const pending = items.entries();
  // counted, not tested for truth: a unit may throw `undefined`.
  const failures: unknown[] = [];
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (const [index, item] of pending) {
      if (failures.length > 0) {
        return;
      }
      try {
        results[index] = await work(item, index);
      } catch (error) {
        failures.push(error);
      }
    }
  });
  await Promise.all(runners);
  if (failures.length > 0) {
    throw failures[0];
  }
  return results;
};
