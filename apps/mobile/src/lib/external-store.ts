// ---------------------------------------------------------------------------
// A minimal external store for `useSyncExternalStore`: one current value,
// change notification, stable accessors. The host status (host/connection.ts)
// and the host-connection snapshot (host/connection-core.ts) both sit on it.
// ---------------------------------------------------------------------------

export type ExternalStore<T> = {
  get: () => T;
  /** Replace the value and notify every subscriber. */
  set: (next: T) => void;
  subscribe: (onChange: () => void) => () => void;
};

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
