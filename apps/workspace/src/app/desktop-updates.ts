// The updater lives in the shell because it replaces the app; the page mirrors its state. The
// shell's door parses every answer and frame before it lands here, so the store only ever holds a
// state it knows. Outside the shell there is no updater, and the page says so instead of
// pretending. The store starts on its first subscriber, never at import.

import { useSyncExternalStore } from "react";

import { shellUpdates, underShell } from "../shell/shell-commands";
import type { UpdateAction, UpdateState } from "../shell/update-state";

type UpdatesSnapshot =
  | { kind: "loading" }
  | { kind: "no-bridge" }
  | { kind: "state"; state: UpdateState };

/** @internal */
export const createUpdatesStore = ({
  getState,
  onState,
}: Pick<typeof shellUpdates, "getState" | "onState">) => {
  const listeners = new Set<() => void>();
  let snapshot: UpdatesSnapshot = { kind: "loading" };
  let started = false;

  const publish = (next: UpdatesSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) {
      listener();
    }
  };
  const adopt = (state: UpdateState): void => {
    publish({ kind: "state", state });
  };
  const readFirst = async (): Promise<void> => {
    try {
      const state = await getState();
      // the shell pushes every move, so a frame or an action adopted while the read was out is newer
      if (snapshot.kind === "loading") {
        adopt(state);
      }
    } catch (error) {
      console.warn("[updates] the shell did not answer", error);
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
    onState(adopt);
    void readFirst();
  };
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    start();
    return () => {
      listeners.delete(listener);
    };
  };
  const getSnapshot = (): UpdatesSnapshot => snapshot;

  return {
    // runs an action against the shell and adopts the state it answers; a no-op outside the shell
    run: async (action: () => Promise<UpdateState>): Promise<void> => {
      if (underShell()) {
        adopt(await action());
      }
    },
    use: (): UpdatesSnapshot => useSyncExternalStore(subscribe, getSnapshot),
  };
};

const store = createUpdatesStore(shellUpdates);

export const useDesktopUpdates = store.use;

// each action answers with the state it left behind, adopted like a pushed frame: a check, or
// Restart to Update, which relaunches the app once the update is in
export const runUpdateAction = async (action: UpdateAction): Promise<void> => {
  await store.run(action.action === "check" ? shellUpdates.check : shellUpdates.install);
};
