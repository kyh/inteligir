import { create } from "zustand";

import { getBridge } from "@renderer/lib/bridge";

// ---------------------------------------------------------------------------
// Renderer mirror of the on-disk UI-state map (~/.inteligir/ui-state.json).
//
// The whole map is loaded once on init so components can read synchronously
// via useDiskState; writes update the in-memory copy immediately and flush to
// disk debounced (drag/resize fire many updates per second).
// ---------------------------------------------------------------------------

type UiStateStore = {
  values: Record<string, unknown>;
  loaded: boolean;
  init: () => Promise<void>;
  set: (key: string, value: unknown) => void;
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
      void getBridge().setUiState({ key, value });
    }, FLUSH_DELAY_MS),
  );
}

let initPromise: Promise<void> | null = null;

export const useUiStateStore = create<UiStateStore>()((set) => ({
  values: {},
  loaded: false,

  init: () => {
    if (initPromise) return initPromise;
    initPromise = getBridge()
      .getUiState()
      .then((values) => set({ values: values ?? {}, loaded: true }))
      .catch((err) => {
        console.warn("[ui-state] failed to load:", err);
        set({ loaded: true });
      });
    return initPromise;
  },

  set: (key, value) => {
    set((s) => ({ values: { ...s.values, [key]: value } }));
    scheduleFlush(key, value);
  },
}));
