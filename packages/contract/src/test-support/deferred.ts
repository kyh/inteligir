// A promise a suite settles by hand.
// Promise.withResolvers would be the native one, but it needs lib ES2024, past the pages' and
// Hermes' ceiling this package is typed to.

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

const unset = (): void => undefined;

export const deferred = (): Deferred => {
  let settle: () => void = unset;
  // oxlint-disable-next-line promise/avoid-new -- the resolver is handed to the suite, which only a promise can do
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
};
