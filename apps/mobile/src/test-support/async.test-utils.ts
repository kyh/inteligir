import { setTimeout } from "node:timers/promises";

export const nextTask = async () => {
  await setTimeout(0);
};
