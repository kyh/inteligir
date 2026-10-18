// the suites' async plumbing: a promise a test settles by hand, and a wait for the next macrotask.
// Promise.withResolvers would be the native deferred, but it needs lib ES2024 in a tsconfig the
// Hermes bundle shares.

import { setTimeout } from "node:timers/promises";

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const unset = (): void => {};

export const deferred = <T = void>(): Deferred<T> => {
  let settle: (value: T) => void = unset;
  // oxlint-disable-next-line promise/avoid-new -- the resolver is handed to the test, which only a promise can do
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
};

// every promise already settled has run its callbacks by then
export const nextTask = async (): Promise<void> => {
  await setTimeout(0);
};
