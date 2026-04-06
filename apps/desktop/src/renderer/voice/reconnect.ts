// ---------------------------------------------------------------------------
// Pure reconnection policy — no timers, no Room, no DOM. Testable in isolation.
// ---------------------------------------------------------------------------

export type ReconnectPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
};

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  maxAttempts: 3,
  baseDelayMs: 2_000,
};

/**
 * Returns the delay in ms for the given attempt, or null if attempts exhausted.
 * Uses exponential backoff: baseDelayMs * 2^attempt.
 */
export function nextReconnectDelay(
  attempt: number,
  policy: ReconnectPolicy,
): number | null {
  if (attempt >= policy.maxAttempts) return null;
  return policy.baseDelayMs * Math.pow(2, attempt);
}
