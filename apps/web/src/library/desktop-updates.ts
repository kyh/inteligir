import { useSyncExternalStore } from "react";

import { desktopBridge } from "./shell/desktop-bridge";
import type { DesktopBridge, DesktopUpdateState } from "./shell/desktop-bridge";

type UpdatesSnapshot = DesktopUpdateState | null;

const ASKS = {
  check: async (bridge: DesktopBridge) => await bridge.checkForUpdates(),
  download: async (bridge: DesktopBridge) => await bridge.downloadUpdate(),
  install: async (bridge: DesktopBridge) => await bridge.installUpdate(),
} satisfies Record<string, (bridge: DesktopBridge) => Promise<DesktopUpdateState | null>>;

export type UpdateMove = keyof typeof ASKS;

export const createUpdatesStore = (bridge: DesktopBridge | null) => {
  const listeners = new Set<() => void>();
  let snapshot: UpdatesSnapshot = bridge === null ? null : { status: "idle" };
  let started = false;

  const adopt = (state: DesktopUpdateState) => {
    snapshot = state;

    for (const listener of listeners) {
      listener();
    }
  };

  const move = async (next: UpdateMove) => {
    if (bridge === null) {
      return;
    }

    const state = await ASKS[next](bridge);

    if (state !== null) {
      adopt(state);
    }
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);

    if (!started && bridge !== null) {
      started = true;
      bridge.onUpdateState(adopt);
      void move("check");
    }

    return (() => {
      listeners.delete(listener);
    }) satisfies () => void;
  };

  const getSnapshot = () => snapshot;

  return {
    move,
    use: () => useSyncExternalStore(subscribe, getSnapshot),
  };
};

const store = createUpdatesStore(desktopBridge());

export const useDesktopUpdates = store.use;

export const moveUpdate = store.move;
