// The updater lives in main because it replaces the app; the page mirrors its state.

import type { DesktopUpdatesBridge } from "../../types";
import type { UpdateAction, UpdateState } from "../../update-state";
import { createBridgeStore } from "./bridge-store";

const store = createBridgeStore<DesktopUpdatesBridge, UpdateState>({
  bridge: () => window.desktopBridge?.updates,
  label: "updates",
  read: async (updates) => await updates.getState(),
  subscribe: (updates, adopt) => {
    updates.onState(adopt);
  },
});

export const useDesktopUpdates = store.use;

// each action answers with the state it left behind, adopted like a pushed frame
export const runUpdateAction = async (action: UpdateAction): Promise<void> => {
  await store.run(async (updates) => await updates[action.action]());
};
