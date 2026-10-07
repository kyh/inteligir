// One shape for every shell-owned state the page mirrors off the bridge. The bridge parses every
// answer and frame before it lands here, so a store only ever holds a state it knows. Outside the
// shell there is no bridge, and the page says so instead of pretending. A store starts on its
// first subscriber, never at import.

import { useSyncExternalStore } from "react";

type BridgeSnapshot<TState> =
  | { kind: "loading" }
  | { kind: "no-bridge" }
  | { kind: "state"; state: TState };

// a refusal crosses as a value; a rejected command is a fault
type BridgeAnswer<TState> = { ok: true; state: TState } | { ok: false; reason: string };

export interface BridgeStoreArgs<TBridge, TState> {
  bridge: () => TBridge | undefined;
  // the first read; one that throws is warned under the label and leaves the store loading
  read: (bridge: TBridge) => Promise<TState>;
  label: string;
  // for a state the shell also moves on its own; adopt() is what a pushed frame calls
  subscribe?: (bridge: TBridge, adopt: (state: TState) => void) => void;
}

export interface BridgeStore<TBridge, TState> {
  use: () => BridgeSnapshot<TState>;
  // runs an action against the bridge and adopts the state it answers; a no-op with no bridge
  run: (action: (bridge: TBridge) => Promise<TState>) => Promise<void>;
  // the shell's refusal, in its words, or null once the answer is adopted or there is no bridge
  settle: (ask: (bridge: TBridge) => Promise<BridgeAnswer<TState>>) => Promise<string | null>;
}

export const createBridgeStore = <TBridge, TState>(
  args: BridgeStoreArgs<TBridge, TState>,
): BridgeStore<TBridge, TState> => {
  const listeners = new Set<() => void>();
  let snapshot: BridgeSnapshot<TState> = { kind: "loading" };
  let started = false;

  const publish = (next: BridgeSnapshot<TState>): void => {
    snapshot = next;
    for (const listener of listeners) {
      listener();
    }
  };
  const adopt = (state: TState): void => {
    publish({ kind: "state", state });
  };
  const readFirst = async (bridge: TBridge): Promise<void> => {
    try {
      const state = await args.read(bridge);
      // the shell pushes every move, so a frame or an action adopted while the read was out is newer
      if (snapshot.kind === "loading") {
        adopt(state);
      }
    } catch (error) {
      console.warn(`[${args.label}] the shell did not answer`, error);
    }
  };
  const start = (): void => {
    if (started) {
      return;
    }
    started = true;
    const bridge = args.bridge();
    if (bridge === undefined) {
      publish({ kind: "no-bridge" });
      return;
    }
    args.subscribe?.(bridge, adopt);
    void readFirst(bridge);
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
    run: async (action) => {
      const bridge = args.bridge();
      if (bridge === undefined) {
        return;
      }
      adopt(await action(bridge));
    },
    settle: async (ask) => {
      const bridge = args.bridge();
      if (bridge === undefined) {
        return null;
      }
      const answer = await ask(bridge);
      if (!answer.ok) {
        return answer.reason;
      }
      adopt(answer.state);
      return null;
    },
    use: () => useSyncExternalStore(subscribe, getSnapshot),
  };
};
