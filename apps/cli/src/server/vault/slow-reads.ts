// the scenario suite's stand-in for storage that answers an open late (a placeholder fetching its
// bytes, a disk waking, a network mount), since no CI machine has any. it delays the answer inside
// the read's slot, so it holds the budget a real stall holds, though not the fs thread itself.

import { setTimeout as delay } from "node:timers/promises";

export interface SlowReads {
  delayMs: number;
  // a vault path and everything under it; "" is the whole vault
  path: string;
}

export type ReadStall = (relPath: string) => Promise<void>;

export const slowReadStall =
  ({ delayMs, path }: SlowReads): ReadStall =>
  async (relPath) => {
    if (path === "" || relPath === path || relPath.startsWith(`${path}/`)) {
      await delay(delayMs);
    }
  };
