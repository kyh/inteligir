import { setTimeout as delay } from "node:timers/promises";
import { expect } from "./assert";

const DEFAULT_INTERVAL_MS = 250;

export interface PollOptions<T> {
  deadlineMs: number;
  intervalMs?: number;
  // the failure names what the last read held, never only that time ran out.
  describe: (last: T) => string;
}

// done may throw through expect to fail at once on a state the wait can never leave.
export async function pollUntil<T, U extends T>(
  read: () => Promise<T>,
  done: (value: T) => value is U,
  options: PollOptions<T>,
): Promise<U>;
export async function pollUntil<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  options: PollOptions<T>,
): Promise<T>;
export async function pollUntil<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  options: PollOptions<T>,
): Promise<T> {
  const deadline = Date.now() + options.deadlineMs;
  for (;;) {
    const value = await read();
    if (done(value)) {
      return value;
    }
    expect(Date.now() < deadline, options.describe(value));
    await delay(options.intervalMs ?? DEFAULT_INTERVAL_MS);
  }
}
