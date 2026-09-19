// The updater lives in main because it replaces the app; the page mirrors its state.

import type { DesktopUpdatesBridge } from "../../types";
import type { UpdateAction, UpdateState } from "../../update-state";
import { createBridgeStore } from "./bridge-store";

const adoptInitial = async (
  updates: DesktopUpdatesBridge,
  adopt: (state: UpdateState) => void,
): Promise<void> => {
  let state;
  try {
    state = await updates.getState();
  } catch (error) {
    console.warn("[updates] the initial state read failed", error);
    return;
  }
  adopt(state);
};

const store = createBridgeStore<DesktopUpdatesBridge, UpdateState>({
  bridge: () => window.desktopBridge?.updates,
  start: (updates, adopt) => {
    updates.onState(adopt);
    void adoptInitial(updates, adopt);
  },
});

export const useDesktopUpdates = store.use;

// each action answers with the state it left behind, adopted like a pushed frame
export const runUpdateAction = async (action: UpdateAction): Promise<void> => {
  await store.run(async (updates) => await updates[action]());
};
