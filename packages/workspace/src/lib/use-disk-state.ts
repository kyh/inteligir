import { useCallback } from "react";

import { useUiStateStore } from "@repo/workspace/stores/ui-state-store";

/**
 * Persisted view state backed by the main-process UI-state store
 * (~/.inteligir/ui-state.json). Reads synchronously from the in-memory mirror
 * (returns `defaultValue` until the store has loaded from disk) and writes
 * through to disk debounced. The companion `loaded` flag lets callers defer
 * rendering layout-sensitive UI until the saved value is available.
 */
export function useDiskState<T>(
  key: string,
  defaultValue: T,
  parseStored: (value: unknown) => T | undefined,
): [T, (value: T) => void, boolean] {
  const loaded = useUiStateStore((s) => s.loaded);
  const stored = useUiStateStore((s) => s.values[key]);
  const setInStore = useUiStateStore((s) => s.set);

  const value = parseStored(stored) ?? defaultValue;

  const setValue = useCallback(
    (next: T) => {
      setInStore(key, next);
    },
    [key, setInStore],
  );

  return [value, setValue, loaded];
}

/**
 * The `parseStored` every string-valued call site needs: an unknown row is a
 * value only if it is a string, and anything else falls back to the default.
 * Lives here rather than in each caller because `useDiskState`'s own signature
 * is what demands it.
 */
export const parseStoredString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
