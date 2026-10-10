// One shape for every shell-owned state the page mirrors. The shell's door parses every answer
// and frame before it lands here, so a store only ever holds a state it knows. Outside the shell
// there is no door, and the page says so instead of pretending. A store starts on its first
// subscriber, never at import.

import { useSyncExternalStore } from "react";
import { underShell } from "../shell-commands";

type BridgeSnapshot<TState> =
  | { kind: "loading" }
  | { kind: "no-bridge" }
  | { kind: "state"; state: TState };

// a refusal crosses as a value; a rejected command is a fault
type BridgeAnswer<TState> = { ok: true; state: TState } | { ok: false; reason: string };

export interface BridgeStoreArgs<TState> {
  // the first read; one that throws is warned under the label and leaves the store loading
  read: () => Promise<TState>;
  label: string;
  // for a state the shell also moves on its own; adopt() is what a pushed frame calls
  subscribe?: (adopt: (state: TState) => void) => void;
}

export interface BridgeStore<TState> {
  use: () => BridgeSnapshot<TState>;
  // runs an action against the shell and adopts the state it answers; a no-op outside the shell
  run: (action: () => Promise<TState>) => Promise<void>;
  // the shell's refusal, in its words, or null once the answer is adopted or outside the shell
  settle: (ask: () => Promise<BridgeAnswer<TState>>) => Promise<string | null>;
}

export const createBridgeStore = <TState>(args: BridgeStoreArgs<TState>): BridgeStore<TState> => {
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
  const readFirst = async (): Promise<void> => {
    try {
      const state = await args.read();
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
    if (!underShell()) {
      publish({ kind: "no-bridge" });
      return;
    }
    args.subscribe?.(adopt);
    void readFirst();
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
      if (!underShell()) {
        return;
      }
      adopt(await action());
    },
    settle: async (ask) => {
      if (!underShell()) {
        return null;
      }
      const answer = await ask();
      if (!answer.ok) {
        return answer.reason;
      }
      adopt(answer.state);
      return null;
    },
    use: () => useSyncExternalStore(subscribe, getSnapshot),
  };
};
