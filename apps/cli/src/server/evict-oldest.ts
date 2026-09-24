const evictOldest = (map: Map<unknown, unknown>, limit: number): void => {
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done === true) {
      return;
    }
    map.delete(oldest.value);
  }
};

// a bounded LRU over a plain Map, which iterates in insertion order: deleting before the set moves
// the key to the newest end, so a read that re-sets what it read keeps it resident, and the oldest
// entry past the limit goes.
export const setMostRecent = <K, V>(map: Map<K, V>, key: K, value: V, limit: number): void => {
  map.delete(key);
  map.set(key, value);
  evictOldest(map, limit);
};
