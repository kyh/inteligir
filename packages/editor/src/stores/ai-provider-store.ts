// ---------------------------------------------------------------------------
// Renderer-wide AI-provider snapshot — the ONE live copy of the host's
// AiProviderSettings that the Settings → AI section, the composer's
// "Connect an AI provider" affordance, and the editor-AI/ghost-text gates all
// share. Every mutating channel returns a fresh snapshot (no push channel by
// design — see provider-service.ts), so routing all mutations through here is
// what keeps the feature gates reactive: connecting a provider in Settings
// flips the composer back to the input in the same frame.
//
// AI is a FEATURE-level gate, never an app gate: "no provider
// connected" degrades the AI surfaces in the workspace; it never blocks app
// entry.
// ---------------------------------------------------------------------------

import { create } from "zustand";

import type { AiProviderSettings } from "@repo/bridge/ai-provider";

import { getBridge } from "@repo/bridge/client";

/**
 * "The SELECTED provider can serve a turn right now" — the AI feature gate.
 * Every turn selects the SELECTED provider host-side (agentModelSelection),
 * so a connected-but-not-selected provider must NOT open the gate: connect
 * Claude while OpenAI is selected and every turn would still target
 * disconnected OpenAI and fail. Providers that need no login (the dev faux
 * provider) report connected: true, so the faux path keeps the gate open.
 * `null` (snapshot not loaded yet) reads as connected: the gates fail OPEN
 * pre-load so the connect affordance never flashes during boot — a genuinely
 * disconnected state settles within the first snapshot, and an early AI call
 * just fails loudly host-side. (Contrast with private notes, which fail
 * CLOSED — that gate prevents leaks; this one only prevents dead-end UI.)
 */
export function hasConnectedProvider(settings: AiProviderSettings | null): boolean {
  if (settings === null) return true;
  const selected = settings.providers.find((p) => p.id === settings.selected.provider);
  return selected?.connected ?? false;
}

type AiProviderStore = {
  settings: AiProviderSettings | null;
  /** Idempotent initial load. */
  init: () => Promise<void>;
  /** Re-fetch the snapshot (after host-side changes, e.g. reauthenticate). */
  refresh: () => Promise<void>;
  /** Patch the persisted provider/model selection. */
  setConfig: (patch: { provider?: string; modelId?: string }) => Promise<void>;
  /** Run the OAuth connect flow for `provider`; resolves when it completes. */
  connect: (provider: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Drop `provider`'s on-device credentials. Touches ONLY pi's auth.json —
   * the app stays in the workspace as a guest, the sync account untouched. */
  disconnect: (provider: string) => Promise<void>;
};

let initStarted = false;

export const useAiProviderStore = create<AiProviderStore>()((set) => ({
  settings: null,

  init: async () => {
    if (initStarted) return;
    initStarted = true;
    try {
      set({ settings: await getBridge().getAiProviderSettings() });
    } catch {
      // Leave null — gates fail open, the section shows its loading state —
      // but UN-latch so a later init() (another consumer mounting, a settings
      // open) retries instead of the first transient failure freezing the
      // snapshot at null until app restart.
      initStarted = false;
    }
  },

  refresh: async () => {
    set({ settings: await getBridge().getAiProviderSettings() });
  },

  setConfig: async (patch) => {
    set({ settings: await getBridge().setAiProviderConfig(patch) });
  },

  connect: async (provider) => {
    const result = await getBridge().connectAiProvider({ provider });
    // Refresh regardless — a failed OAuth may still have changed nothing, but
    // the snapshot is the single source of truth for every gate.
    set({ settings: await getBridge().getAiProviderSettings() });
    return result;
  },

  disconnect: async (provider) => {
    set({ settings: await getBridge().disconnectAiProvider({ provider }) });
  },
}));

/** Live gate hook for the AI surfaces (composer, editor AI, ghost text). */
export function useAiProviderConnected(): boolean {
  return useAiProviderStore((s) => hasConnectedProvider(s.settings));
}
