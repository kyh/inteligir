// first occurrence per key logs in full, every REPORT_EVERY-th repeat logs the count: a chatty harness stays
// visible without flooding.

const REPORT_EVERY = 100;

// thr_x/turn_x-style prefixed ids, long hex runs, and absolute paths.
const VOLATILE_ID_PATTERN = /\b[a-z]+_[a-z0-9-]{4,}\b|\b[0-9a-f]{12,}\b|(?:\/[\w.-]+){2,}/gi;

export function boundedLogKey(message: string): string {
  return message.replace(VOLATILE_ID_PATTERN, "<id>");
}

export function createBoundedAgentLog(
  write: (line: string) => void = (line) => console.warn(line),
): (message: string) => void {
  const countsByKey = new Map<string, number>();
  return (message) => {
    const key = boundedLogKey(message);
    const count = (countsByKey.get(key) ?? 0) + 1;
    countsByKey.set(key, count);
    if (count === 1) {
      write(`agent: ${message}`);
      return;
    }
    if (count % REPORT_EVERY === 0) {
      write(`agent: seen ${count}x — ${key}`);
    }
  };
}
