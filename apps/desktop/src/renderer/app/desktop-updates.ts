// The updater lives in main because it replaces the app; the page mirrors its state.

import type { DesktopUpdatesBridge } from "../../types";
import type { UpdateAction, UpdateState } from "../../update-state";
import { createBridgeStore } from "./bridge-store";

const store = createBridgeStore<DesktopUpdatesBridge, UpdateState>({
  bridge: () => window.desktopBridge?.updates,
  start: (updates, adopt) => {
    updates.onState(adopt);
    updates.getState().then(adopt, (cause: unknown) => {
      console.warn("[updates] the initial state read failed", cause);
    });
  },
});

export const useDesktopUpdates = store.use;

// each action answers with the state it left behind, adopted like a pushed frame
export function runUpdateAction(action: UpdateAction): Promise<void> {
  return store.run((updates) => updates[action]());
}
