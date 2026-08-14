// Editor-AI settings — ghost-text feature flag + fast-model choice, persisted
// through the generic ui-state channel (host-side ui-state store;
// the host's ghost session reads the same keys). The store is the live copy
// both the settings panel and the ghost-text kit subscribe to.

import { create } from "zustand";

import {
  GHOST_TEXT_ENABLED_UI_STATE,
  GHOST_TEXT_MODEL_UI_STATE,
  type GhostModel,
} from "@repo/bridge/inline-ai";

import { getBridge } from "@repo/bridge/client";

type AiSettingsState = {
  loaded: boolean;
  ghostTextEnabled: boolean;
  /** Explicit model choice; null = the host's default fast tier. */
  ghostTextModel: string | null;
  models: GhostModel[];
  defaultModelId: string | null;
  /** Idempotent initial load (ui-state + model list). */
  init: () => Promise<void>;
  setGhostTextEnabled: (enabled: boolean) => Promise<void>;
  setGhostTextModel: (id: string | null) => Promise<void>;
  /** Drop this account's settings (./workspace-runtime disposes on sign-out). */
  reset: () => void;
};

let initStarted = false;

const INITIAL: Pick<
  AiSettingsState,
  "loaded" | "ghostTextEnabled" | "ghostTextModel" | "models" | "defaultModelId"
> = {
  loaded: false,
  ghostTextEnabled: true,
  ghostTextModel: null,
  models: [],
  defaultModelId: null,
};

export const useAiSettingsStore = create<AiSettingsState>()((set) => ({
  ...INITIAL,

  init: async () => {
    if (initStarted) return;
    initStarted = true;
    const bridge = getBridge();
    const [uiState, ghostModels] = await Promise.all([
      bridge.getUiState().catch((): Record<string, unknown> => ({})),
      bridge.listGhostModels().catch(() => ({ models: [], defaultId: null })),
    ]);
    // Default ON: absence of the key means enabled; only a stored `false`
    // (the user toggled it off in Settings) disables.
    const enabled = uiState[GHOST_TEXT_ENABLED_UI_STATE] !== false;
    const model = uiState[GHOST_TEXT_MODEL_UI_STATE];
    set({
      loaded: true,
      ghostTextEnabled: enabled,
      ghostTextModel: typeof model === "string" ? model : null,
      models: ghostModels.models,
      defaultModelId: ghostModels.defaultId,
    });
  },

  setGhostTextEnabled: async (enabled) => {
    set({ ghostTextEnabled: enabled });
    await getBridge().setUiState({ key: GHOST_TEXT_ENABLED_UI_STATE, value: enabled });
  },

  setGhostTextModel: async (id) => {
    set({ ghostTextModel: id });
    // `undefined` clears the key — the host falls back to its default tier.
    await getBridge().setUiState({ key: GHOST_TEXT_MODEL_UI_STATE, value: id ?? undefined });
  },

  reset: () => {
    initStarted = false;
    set(INITIAL);
  },
}));
