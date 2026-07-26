// ---------------------------------------------------------------------------
// The one yield long synchronous sweeps use between slices. Lives in the leaf
// substrate so every sweep in the host spells it the same way — the vault stat
// sweep, the knowledge hydration/projection batches, and anything that follows.
// ---------------------------------------------------------------------------

/** Hand the event loop a turn between slices of a long sweep.
 *
 * `setImmediate`, NOT `setTimeout(resolve, 0)`: a timer is clamped to ~1ms, so
 * a sweep budgeted in 15ms slices would pay a per-slice millisecond tax for
 * nothing. And not a bare `await` either — a microtask hop never lets timers or
 * I/O callbacks run, so it is not a yield at all. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
