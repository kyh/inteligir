import type { KvStorage } from "../waiting-saves";

export interface MemoryKv extends KvStorage {
  readonly held: ReadonlyMap<string, string>;
  readonly failWrites: (failing: boolean) => void;
}

export const memoryKv = () => {
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
  } satisfies MemoryKv;
};
