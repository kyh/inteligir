import { create } from "zustand";

import { getBridge } from "@repo/bridge/client";
import { workspaceBoot } from "@repo/workspace/stores/workspace-boot";

// ---------------------------------------------------------------------------
// Client mirror of the host's UI-state map.
//
// The whole map arrives with the boot bundle so components can read
// synchronously via useDiskState; writes update the in-memory copy immediately
// and flush to the host debounced (drag/resize fire many updates per second).
// ---------------------------------------------------------------------------

type UiStateStore = {
  values: Record<string, unknown>;
  loaded: boolean;
  init: () => Promise<void>;
  set: (key: string, value: unknown) => void;
  /** Drop this account's values and cancel pending writes
   * (./workspace-runtime disposes on sign-out). */
  reset: () => void;
};

const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const FLUSH_DELAY_MS = 250;

function scheduleFlush(key: string, value: unknown): void {
  const existing = flushTimers.get(key);
  if (existing) clearTimeout(existing);
  flushTimers.set(
    key,
    setTimeout(() => {
      flushTimers.delete(key);
      // A debounced write can fire in the window between the transport being
      // disposed and this timer being cleared — a sign-out is exactly that
      // race. The write belongs to the session that just ended, so losing it
      // is correct; letting it reject is not, because an unhandled rejection
      // on every sign-out trains everyone to ignore the console.
      void getBridge()
        .setUiState({ key, value })
        .catch(() => {});
    }, FLUSH_DELAY_MS),
  );
}

let initPromise: Promise<void> | null = null;

export const useUiStateStore = create<UiStateStore>()((set) => ({
  values: {},
  loaded: false,

  init: () => {
    if (initPromise) return initPromise;
    initPromise = workspaceBoot()
      .then((boot) => set({ values: boot.uiState, loaded: true }))
      .catch((err: unknown) => {
        console.warn("[ui-state] failed to load:", err);
        set({ loaded: true });
      });
    return initPromise;
  },

  set: (key, value) => {
    set((s) => ({ values: { ...s.values, [key]: value } }));
    scheduleFlush(key, value);
  },

  reset: () => {
    // Cancelled, never flushed: a debounced write belongs to the account whose
    // socket just closed, and firing it after sign-out either fails or lands on
    // the next account's host.
    for (const timer of flushTimers.values()) clearTimeout(timer);
    flushTimers.clear();
    initPromise = null;
    set({ values: {}, loaded: false });
  },
}));
