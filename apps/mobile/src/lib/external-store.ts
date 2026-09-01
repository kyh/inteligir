// A minimal external store for `useSyncExternalStore`: one current value, change
// notification, stable accessors.

export interface ExternalStore<T> {
  get: () => T;
  /** Replace the value and notify every subscriber. */
  set: (next: T) => void;
  subscribe: (onChange: () => void) => () => void;
}

/** The read half — what a screen holds. A module that owns its state publishes
 *  this and keeps `set` to itself, so the one writer is the one that knows when
 *  the value moved. */
export type ReadableStore<T> = Pick<ExternalStore<T>, "get" | "subscribe">;

export function createExternalStore<T>(initial: T): ExternalStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
}
