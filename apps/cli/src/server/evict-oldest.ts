// Map iterates in insertion order, so a caller that re-inserts on every read makes this an LRU.
export const evictOldest = (map: Map<unknown, unknown>, limit: number): void => {
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done === true) {
      return;
    }
    map.delete(oldest.value);
  }
};
