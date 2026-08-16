// ---------------------------------------------------------------------------
// The ONE live copy of the host's AiProviderSettings — shared by Settings →
// AI, the composer's "Connect an AI provider" affordance, and the editor-AI /
// ghost-text gates. Every mutating channel returns a fresh snapshot and the
// host PUSHES one (`onAiProviderChanged`) whenever it changed without being
// asked, so routing everything through here is what keeps the feature gates
// reactive: connecting a provider flips the composer back to the input in the
// same frame, whichever surface started it.
//
// It also owns the connect FLOW, because that flow does not finish where it
// starts. `connectAiProvider` answers with the provider's consent URL and
// nothing more; somebody has to send the user there, hold a state while they
// are gone, and notice when the host's callback lands. Two surfaces offer the
// button, so that lives here once rather than twice.
//
// AI is a FEATURE-level gate, never an app gate: "no provider connected"
// degrades the AI surfaces in the workspace; it never blocks app entry.
// ---------------------------------------------------------------------------

import { create } from "zustand";

import type { AiConnectResult, AiProviderSettings } from "@repo/bridge/ai-provider";

import { getBridge } from "@repo/bridge/client";

/**
 * "The SELECTED provider can serve a turn right now" — the AI feature gate.
 * Every turn selects the SELECTED provider host-side (agentModelSelection),
 * so a connected-but-not-selected provider must NOT open the gate: connect
 * Claude while OpenAI is selected and every turn would still target
 * disconnected OpenAI and fail. Providers that need no login (the sandbox
 * provider) report connected: true, so that path keeps the gate open.
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

/**
 * Where a connect attempt is.
 *
 * `awaiting` is the state this whole store exists to hold: the user is on the
 * provider's consent page in ANOTHER tab, the host will complete the exchange
 * on its own callback, and this tab learns about it from a pushed snapshot. It
 * carries the URL because nothing guarantees the tab opened — a popup blocker
 * or a shell that denies popups both leave the user with nowhere to go unless
 * the surfaces can render it as a link.
 */
export type ProviderConnectState =
  | { readonly phase: "idle" }
  | { readonly phase: "starting"; readonly provider: string }
  | { readonly phase: "awaiting"; readonly provider: string; readonly authorizeUrl: string }
  | { readonly phase: "failed"; readonly provider: string; readonly error: string };

const IDLE: ProviderConnectState = { phase: "idle" };

type AiProviderStore = {
  settings: AiProviderSettings | null;
  /** The connect attempt in flight, if any. Global rather than per-surface: a
   * connect started in Settings is still running when the dialog closes. */
  connect: ProviderConnectState;
  /** Idempotent initial load + the host's push subscription. */
  init: () => Promise<void>;
  /** Re-fetch the snapshot (after host-side changes, e.g. reauthenticate). */
  refresh: () => Promise<void>;
  /** Patch the persisted provider/model selection. */
  setConfig: (patch: { provider?: string; modelId?: string }) => Promise<void>;
  /** Start the OAuth flow for `provider` and send the user to the consent page.
   * Resolves once the user has been sent — NOT when they are connected. */
  startConnect: (provider: string) => Promise<void>;
  /** Give up on the attempt in flight, or clear the sentence a failed one
   * left. Nothing host-side to cancel: the parked verifier expires on its own
   * and the next attempt replaces it. */
  dismissConnect: () => void;
  /** Drop the host's sealed credential for `provider`. Touches ONLY that
   * credential — the user's own account is untouched. */
  disconnect: (provider: string) => Promise<void>;
  /** Drop this account's snapshot (./workspace-runtime disposes on sign-out). */
  reset: () => void;
};

let initStarted = false;
let subscribed = false;

export const useAiProviderStore = create<AiProviderStore>()((set, get) => ({
  settings: null,
  connect: IDLE,

  init: async () => {
    if (initStarted) return;
    initStarted = true;
    try {
      const bridge = getBridge();
      if (!subscribed) {
        subscribed = true;
        // Never unsubscribed: this snapshot is app-wide and outlives every
        // component that reads it. The push is also what ends an `awaiting`
        // state, so it is installed before the first connect can start.
        bridge.onAiProviderChanged((settings) => {
          set((state) => ({ settings, connect: settleConnect(state.connect, settings) }));
        });
      }
      set({ settings: await bridge.getAiProviderSettings() });
    } catch {
      // Leave null — gates fail open, the section shows its loading state —
      // but UN-latch so a later init() (another consumer mounting, a settings
      // open) retries instead of the first transient failure freezing the
      // snapshot at null until app restart.
      initStarted = false;
    }
  },

  reset: () => {
    // BOTH latches clear. The onAiProviderChanged handler was installed on the
    // BRIDGE, and a sign-out disposes that transport with the subscription on
    // it — so the next session's bridge is a different object with no
    // subscribers at all. Keeping `subscribed` latched would mean never
    // installing one, and since that push is the only thing that settles an
    // `awaiting` connect, the second session's Connect button would spin
    // forever with editor AI gated off behind it.
    initStarted = false;
    subscribed = false;
    set({ settings: null, connect: IDLE });
  },

  refresh: async () => {
    set({ settings: await getBridge().getAiProviderSettings() });
  },

  setConfig: async (patch) => {
    set({ settings: await getBridge().setAiProviderConfig(patch) });
  },

  startConnect: async (provider) => {
    set({ connect: { phase: "starting", provider } });
    let result: AiConnectResult;
    try {
      result = await getBridge().connectAiProvider({ provider });
    } catch {
      set({ connect: { phase: "failed", provider, error: "Couldn't reach the host." } });
      return;
    }
    if (!result.ok) {
      set({ connect: { phase: "failed", provider, error: result.error } });
      return;
    }
    set({ connect: { phase: "awaiting", provider, authorizeUrl: result.authorizeUrl } });
    openAuthorizePage(result.authorizeUrl);
  },

  dismissConnect: () => {
    set({ connect: IDLE });
  },

  disconnect: async (provider) => {
    const settings = await getBridge().disconnectAiProvider({ provider });
    const connect = get().connect;
    set({
      settings,
      // Disconnecting the provider an attempt is waiting on ends the attempt:
      // whatever the user does on that consent page, this is now the answer.
      connect: connect.phase !== "idle" && connect.provider === provider ? IDLE : connect,
    });
  },
}));

/**
 * What a pushed snapshot means for an attempt in flight.
 *
 * The host settles the client on EVERY outcome that spent the parked verifier —
 * a completed exchange, a declined consent, a token endpoint that refused — and
 * the snapshot alone says which: the provider is connected, or it is not. The
 * consent tab carries the provider's own reason; this side only has to stop
 * claiming the attempt is still running.
 */
function settleConnect(
  state: ProviderConnectState,
  settings: AiProviderSettings,
): ProviderConnectState {
  if (state.phase !== "awaiting") return state;
  const provider = settings.providers.find((p) => p.id === state.provider);
  if (provider?.connected === true) return IDLE;
  return {
    phase: "failed",
    provider: state.provider,
    error: `${provider?.label ?? state.provider} wasn't connected — the sign-in was cancelled or refused.`,
  };
}

/**
 * Send the user to the provider's consent page.
 *
 * A NEW TAB, never this one: the workspace holds an open note with unsaved
 * keystrokes behind a debounce, and the round-trip completes on the host rather
 * than on a return navigation, so there is nothing to come back to. `noopener`
 * severs the reverse handle, which also means the return value carries no
 * signal — a blocked popup and a shell that denies popups (having already
 * handed the URL to the system browser) are indistinguishable from here. That
 * is why the surfaces render `authorizeUrl` as a link either way instead of
 * guessing which happened.
 */
function openAuthorizePage(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Live gate hook for the AI surfaces (composer, editor AI, ghost text). */
export function useAiProviderConnected(): boolean {
  return useAiProviderStore((s) => hasConnectedProvider(s.settings));
}
