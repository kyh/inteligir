export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason: Error) => void;
}

export const deferred = <T = void>() => {
  let settle: Deferred<T>["resolve"] | undefined;
  let fail: Deferred<T>["reject"] | undefined;

  // oxlint-disable-next-line promise/avoid-new -- a promise settled from outside its executor has no async/await form
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  if (settle === undefined || fail === undefined) {
    throw new Error("the promise executor did not run");
  }

  return { promise, reject: fail, resolve: settle } satisfies Deferred<T>;
};
