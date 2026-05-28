import { useCallback } from "react";

import { useUiStateStore } from "@/renderer/stores/ui-state-store";

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
): [T, (value: T | ((prev: T) => T)) => void, boolean] {
  const loaded = useUiStateStore((s) => s.loaded);
  const stored = useUiStateStore((s) => s.values[key]);
  const setInStore = useUiStateStore((s) => s.set);

  const value = stored === undefined ? defaultValue : (stored as T);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const current =
        useUiStateStore.getState().values[key] === undefined
          ? defaultValue
          : (useUiStateStore.getState().values[key] as T);
      const resolved =
        typeof next === "function" ? (next as (prev: T) => T)(current) : next;
      setInStore(key, resolved);
    },
    [key, defaultValue, setInStore],
  );

  return [value, setValue, loaded];
}
