// The phone's key-value store in memory, as its suites hold it: what a relaunch reads is whatever
// the last run left in the same map.

import type { KvStorage } from "../items/share-outbox";

/** @internal */
export interface MemoryKv extends KvStorage {
  readonly held: ReadonlyMap<string, string>;
  // the next writes fail, as a full disk's would
  readonly failWrites: (failing: boolean) => void;
}

/** @internal */
export const memoryKv = (): MemoryKv => {
  const held = new Map<string, string>();
  let failing = false;
  return {
    failWrites: (next) => {
      failing = next;
    },
    getAllKeys: async () => await Promise.resolve([...held.keys()]),
    getItem: async (key) => await Promise.resolve(held.get(key) ?? null),
    held,
    removeItem: async (key) => {
      held.delete(key);
      await Promise.resolve();
    },
    setItem: async (key, value) => {
      if (failing) {
        throw new Error("database or disk is full");
      }
      held.set(key, value);
      await Promise.resolve();
    },
  };
};
