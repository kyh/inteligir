// The updater lives in the Mac app's shell because it replaces the app; the page mirrors the state
// the shell pushes and asks it to move. One store, so the notice and Settings say one thing. It
// starts on its first subscriber, never at import, and starts with a check, as the page loads.

import { useSyncExternalStore } from "react";

import { desktopBridge } from "../shell/desktop-bridge";
import type { DesktopBridge, DesktopUpdateState } from "../shell/desktop-bridge";

/** null in a browser tab, which has no updater. */
type UpdatesSnapshot = DesktopUpdateState | null;

const ASKS = {
  check: async (bridge: DesktopBridge) => await bridge.checkForUpdates(),
  download: async (bridge: DesktopBridge) => await bridge.downloadUpdate(),
  install: async (bridge: DesktopBridge) => await bridge.installUpdate(),
} satisfies Record<string, (bridge: DesktopBridge) => Promise<DesktopUpdateState>>;

export type UpdateMove = keyof typeof ASKS;

/** @internal */
export const createUpdatesStore = (bridge: DesktopBridge | null) => {
  const listeners = new Set<() => void>();
  let snapshot: UpdatesSnapshot = bridge === null ? null : { status: "idle" };
  let started = false;

  const adopt = (state: DesktopUpdateState): void => {
    snapshot = state;
    for (const listener of listeners) {
      listener();
    }
  };
  // a shell that refuses the call answers as an update that did not go through, so every screen
  // already has its words for it
  const move = async (next: UpdateMove): Promise<void> => {
    if (bridge === null) {
      return;
    }
    try {
      adopt(await ASKS[next](bridge));
    } catch (error) {
      console.warn("[desktop] the updater did not answer", error);
      adopt({ message: "The updater did not answer.", status: "error" });
    }
  };
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    if (!started && bridge !== null) {
      started = true;
      bridge.onUpdateState(adopt);
      void move("check");
    }
    return () => {
      listeners.delete(listener);
    };
  };
  const getSnapshot = (): UpdatesSnapshot => snapshot;

  return {
    move,
    use: (): UpdatesSnapshot => useSyncExternalStore(subscribe, getSnapshot),
  };
};

const store = createUpdatesStore(desktopBridge());

export const useDesktopUpdates = store.use;

export const moveUpdate = store.move;
