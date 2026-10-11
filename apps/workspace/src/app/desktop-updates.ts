// The updater lives in the shell because it replaces the app; the page mirrors its state.

import type { UpdateAction, UpdateState } from "../shell/update-state";
import { shellUpdates } from "../shell/shell-commands";
import { createBridgeStore } from "./bridge-store";

const store = createBridgeStore<UpdateState>({
  label: "updates",
  read: shellUpdates.getState,
  subscribe: (adopt) => {
    shellUpdates.onState(adopt);
  },
});

export const useDesktopUpdates = store.use;

// each action answers with the state it left behind, adopted like a pushed frame
export const runUpdateAction = async (action: UpdateAction): Promise<void> => {
  await store.run(shellUpdates[action.action]);
};
