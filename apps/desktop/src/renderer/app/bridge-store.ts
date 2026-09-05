// One shape for every main-owned state the page mirrors off the bridge (the updater, the spell
// checker, the vaults). The preload parses every frame before it lands here, so a store only
// ever holds a state it knows. Outside the shell there is no bridge, and the page says so
// instead of pretending. A store starts on its first subscriber, never at import.

import { useSyncExternalStore } from "react";

type BridgeSnapshot<TState> =
  | { kind: "loading" }
  | { kind: "no-bridge" }
  | { kind: "state"; state: TState };

export interface BridgeStoreArgs<TBridge, TState> {
  bridge: () => TBridge | undefined;
  // the first read, and any push subscription; adopt() is what a pushed frame calls
  start: (bridge: TBridge, adopt: (state: TState) => void) => void;
}

export interface BridgeStore<TBridge, TState> {
  use: () => BridgeSnapshot<TState>;
  adopt: (state: TState) => void;
  // runs an action against the bridge and adopts the state it answers; a no-op with no bridge
  run: (action: (bridge: TBridge) => Promise<TState>) => Promise<void>;
}

export function createBridgeStore<TBridge, TState>(
  args: BridgeStoreArgs<TBridge, TState>,
): BridgeStore<TBridge, TState> {
  const listeners = new Set<() => void>();
  let snapshot: BridgeSnapshot<TState> = { kind: "loading" };
  let started = false;

  const publish = (next: BridgeSnapshot<TState>): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const adopt = (state: TState): void => {
    publish({ kind: "state", state });
  };
  const start = (): void => {
    if (started) return;
    started = true;
    const bridge = args.bridge();
    if (bridge === undefined) {
      publish({ kind: "no-bridge" });
      return;
    }
    args.start(bridge, adopt);
  };
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    start();
    return () => {
      listeners.delete(listener);
    };
  };
  const getSnapshot = (): BridgeSnapshot<TState> => snapshot;

  return {
    use: () => useSyncExternalStore(subscribe, getSnapshot),
    adopt,
    run: async (action) => {
      const bridge = args.bridge();
      if (bridge === undefined) return;
      adopt(await action(bridge));
    },
  };
}
