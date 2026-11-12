// a wait for the next macrotask, by which every promise already settled has run its callbacks

import { setTimeout } from "node:timers/promises";

export const nextTask = async (): Promise<void> => {
  await setTimeout(0);
};
