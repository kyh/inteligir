import { describe, expect, it } from "vitest";
import { THREAD_LIFECYCLE } from "../thread-lifecycle";
import { isThreadRunning, threadStatusValues } from "../thread-status";

describe("isThreadRunning", () => {
  it.each(threadStatusValues)(
    "agrees with the lifecycle on %s: running is where a turn can fail, settled where one can start",
    (status) => {
      const transitions = THREAD_LIFECYCLE[status];
      expect(isThreadRunning(status)).toBe(transitions["run.failed"] !== undefined);
      expect(isThreadRunning(status)).toBe(transitions["run.preparing"] === undefined);
    },
  );
});
