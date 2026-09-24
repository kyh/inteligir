// `inteligir action wait`'s defaults and caps, beside the guide that states them so the two cannot drift.

export const DEFAULT_WAIT_TIMEOUT_SECONDS = 600;
export const DEFAULT_WAIT_POLL_INTERVAL_MS = 300;
// node fires a timer set past 2^31-1 ms (about 24.8 days) after 1 ms, so an unbounded wait would give up at once.
export const MAX_WAIT_TIMEOUT_SECONDS = 86_400;
export const MAX_WAIT_POLL_INTERVAL_MS = 60_000;
