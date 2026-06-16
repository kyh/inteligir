// ---------------------------------------------------------------------------
// Pure token-bucket rate limiter.
//
// The relay DO keeps one bucket per live WebSocket connection (in-memory —
// the DO stays resident while sockets are open, and a reset just refills the
// bucket). This is abuse protection, not chat throttling: the limits are far
// above anything a streaming transcript produces.
//
// Pure functions over immutable state so the arithmetic is unit-testable
// without a Workers runtime.
// ---------------------------------------------------------------------------

export type TokenBucketConfig = {
  /** Burst size: max frames accepted back-to-back from a full bucket. */
  capacity: number;
  /** Sustained refill rate, in tokens per second. */
  refillPerSecond: number;
};

export type TokenBucketState = {
  /** Tokens remaining; fractional between refills. */
  tokens: number;
  /** Timestamp (ms) the bucket was last refilled. */
  refilledAtMs: number;
};

export function newTokenBucket(config: TokenBucketConfig, nowMs: number): TokenBucketState {
  return { tokens: config.capacity, refilledAtMs: nowMs };
}

/** Attempt to take one token at `nowMs`. Returns the next bucket state and
 * whether the frame is allowed. Clock skew (nowMs in the past) refills zero
 * rather than going negative. */
export function takeToken(
  config: TokenBucketConfig,
  state: TokenBucketState,
  nowMs: number,
): { state: TokenBucketState; allowed: boolean } {
  const elapsedMs = Math.max(0, nowMs - state.refilledAtMs);
  const tokens = Math.min(
    config.capacity,
    state.tokens + (elapsedMs / 1000) * config.refillPerSecond,
  );
  if (tokens < 1) {
    return { state: { tokens, refilledAtMs: nowMs }, allowed: false };
  }
  return { state: { tokens: tokens - 1, refilledAtMs: nowMs }, allowed: true };
}
