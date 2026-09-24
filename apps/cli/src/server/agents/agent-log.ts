// first occurrence per key logs in full, every REPORT_EVERY-th repeat logs the count: a chatty harness stays
// visible without flooding. the keys are bounded too, least recently seen first out: a class that
// comes back after eviction logs in full once more.

import { setMostRecent } from "../evict-oldest";

const REPORT_EVERY = 100;
const MAX_KEYS = 512;

// thr_x/turn_x-style prefixed ids, long hex runs, absolute paths, ISO-8601 timestamps, and runs of
// three or more digits (a duration in ms, a byte count); a short number such as an exit code stays.
const VOLATILE_ID_PATTERN =
  /\b[a-z]+_[a-z0-9-]{4,}\b|\b[0-9a-f]{12,}\b|(?:\/[\w.-]+){2,}|\b\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?|\b\d{3,}(?:\.\d+)?(?:ms)?\b/giu;

export const boundedLogKey = (message: string): string =>
  message.replace(VOLATILE_ID_PATTERN, "<id>");

export const createBoundedAgentLog =
  (
    write: (line: string) => void = (line) => {
      console.warn(line);
    },
    countsByKey = new Map<string, number>(),
  ): ((message: string) => void) =>
  (message) => {
    const key = boundedLogKey(message);
    const count = (countsByKey.get(key) ?? 0) + 1;
    setMostRecent(countsByKey, key, count, MAX_KEYS);
    if (count === 1) {
      write(`agent: ${message}`);
      return;
    }
    if (count % REPORT_EVERY === 0) {
      write(`agent: seen ${count}x — ${key}`);
    }
  };
