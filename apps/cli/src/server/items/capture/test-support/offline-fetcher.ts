// what a booted suite's capture dials by default: nothing. Every fetch (and every reach a captured
// page would be judged by) waits until its fill is stopped, so a saved link stays a stub for the
// whole suite, no page leaves the machine, and no fill races a suite's own reads.

import type { FetchResult, GuardedFetch, ReachResult } from "../guarded-fetch";

const untilAborted = async <T>(signal: AbortSignal | undefined, answer: T): Promise<T> => {
  if (signal?.aborted === true) {
    return await Promise.resolve(answer);
  }
  const answered = Promise.withResolvers<T>();
  signal?.addEventListener(
    "abort",
    () => {
      answered.resolve(answer);
    },
    { once: true },
  );
  return await answered.promise;
};

const ABORTED: FetchResult & ReachResult = { failure: { kind: "aborted" }, ok: false };

export const offlineFetcher: GuardedFetch = {
  fetch: async (request) => await untilAborted(request.signal, ABORTED),
  reachOf: async (_url, signal) => await untilAborted(signal, ABORTED),
};
