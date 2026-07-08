// Serialize scheduler — takes the whole-document markdown serialize off the
// per-keystroke path. Plate's onChange fires on every content-changing edit;
// serializing the entire Slate document synchronously there is O(document) work
// per input event (typing lag in large notes). This coalesces those serializes
// behind a short debounce and exposes a synchronous flush so the save/close
// paths still see the latest bytes.
//
// Pure timing machinery around an injected `doSerialize` (which does the actual
// serialize → echo-dedupe → onChange in the component). No Plate/React
// coupling, so it unit-tests in plain node.

/** How long after the last qualifying change the serialize waits before it
 * runs. Bounds per-keystroke work without changing what reaches disk — the
 * 600ms autosave debounce downstream still gates the actual write. */
export const SERIALIZE_DEBOUNCE_MS = 150;

export type SerializeScheduler = {
  /** Schedule a serialize, coalescing with any already-pending one (the timer
   * resets, so a burst of keystrokes yields a single serialize). */
  schedule(): void;
  /** Run a pending serialize NOW and clear the timer. No-op when nothing is
   * pending — safe to call from every save/close/flush path unconditionally. */
  flush(): void;
  /** Drop a pending serialize WITHOUT running it (e.g. the content is about to
   * be overwritten and the pending bytes are stale). */
  cancel(): void;
};

/** Create a scheduler around `doSerialize`. `delayMs` is injectable for tests;
 * defaults to {@link SERIALIZE_DEBOUNCE_MS}. */
export function createSerializeScheduler(
  doSerialize: () => void,
  delayMs: number = SERIALIZE_DEBOUNCE_MS,
): SerializeScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(): void {
      clear();
      timer = setTimeout(() => {
        timer = null;
        doSerialize();
      }, delayMs);
    },
    flush(): void {
      if (timer === null) return;
      clear();
      doSerialize();
    },
    cancel(): void {
      clear();
    },
  };
}
