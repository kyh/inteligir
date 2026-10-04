// `Promise.withResolvers`, spelled out: the WebKit this package ships in lacks it below Safari 17.4,
// and both its hosts go lower (the desktop window at the macOS 13.5 floor runs Safari 16.6's, the
// phone page iOS 16.4's). `lib` stops at ES2023 for the same reason (tsconfig.json).

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason: Error) => void;
}

export const deferred = <T>(): Deferred<T> => {
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
  return { promise, reject: fail, resolve: settle };
};
