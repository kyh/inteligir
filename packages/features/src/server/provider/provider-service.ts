// ---------------------------------------------------------------------------
// Provider service — the host's one answer to "which provider+model is the
// agent on, and is it usable?". Glues the dumb store (provider-config) to the
// pure normalization logic (provider-catalog) and pi's on-device credential
// store (agent/auth). Every Agent construction site selects its model through
// here (as a neutral {provider, modelId} pair — resolution to a pi Model
// happens inside the PiAgent wrapper, #460), so switching providers in
// Settings takes effect on the next session start — no restart-time const
// anywhere.
// ---------------------------------------------------------------------------

import { getAuthStorage, isProviderAuthed, login, logoutProvider } from "../agent/auth";
import { toErrorMessage } from "@repo/bridge/wire-helpers";
import type { ModelSelection } from "@repo/features/server/pi/model";
import type { Api, Model } from "@repo/features/server/pi/pi-types";
import type { AiConnectResult, AiProviderSettings } from "@repo/bridge/ai-provider";

import { FAUX_PROVIDER_ID, isFauxAgentEnabled } from "./faux-provider";
import {
  applySelectionPatch,
  catalogEntry,
  listProviderModels,
  listSupportedProviders,
  normalizeSelection,
  parseSupportedProvider,
  providerRequiresAuth,
  type SupportedProviderId,
} from "./provider-catalog";
import { getProviderConfig } from "./provider-config";

/** The active selection, normalized. The INTELIGIR_FAUX_AGENT dev flag FORCES
 * faux (deterministic, login-free) without touching the store, so the user's
 * real selection survives a flagged run. */
export function getSelectedProvider(): { provider: SupportedProviderId; modelId: string } {
  if (isFauxAgentEnabled()) {
    return { provider: FAUX_PROVIDER_ID, modelId: catalogEntry(FAUX_PROVIDER_ID).defaultModelId };
  }
  return normalizeSelection(getProviderConfig().get());
}

/** pi's prompt gate requires SOME auth for the model's provider; a runtime
 * key (never persisted) satisfies it and the faux stream ignores the value.
 * Re-asserted on every selection because logout rebuilds the AuthStorage. */
function ensureFauxRuntimeAuth(provider: SupportedProviderId): void {
  if (provider !== FAUX_PROVIDER_ID) return;
  getAuthStorage().setRuntimeApiKey(FAUX_PROVIDER_ID, "faux-dev-key");
}

/** Pair `modelId` with the SELECTED provider — the ghost-text session's
 * fast-model override rides through here so its override follows a provider
 * switch instead of pointing at a foreign registry. Resolution to a pi Model
 * happens inside the PiAgent wrapper at start() (#460). */
export function providerModelSelection(modelId: string): ModelSelection {
  const { provider } = getSelectedProvider();
  ensureFauxRuntimeAuth(provider);
  return { provider, modelId };
}

/** The selected provider+model pair every default Agent session runs on —
 * passed as the lazy `selectModel` thunk in AgentOptions and resolved to a
 * pi Model inside the PiAgent wrapper at start() (#460: pi-ai's Model type
 * stays inside server/pi/*). */
export function agentModelSelection(): ModelSelection {
  const selection = getSelectedProvider();
  ensureFauxRuntimeAuth(selection.provider);
  return selection;
}

/** Models the selected provider can run (the ghost-text settings picker). */
export function listSelectedProviderModels(): Model<Api>[] {
  return listProviderModels(getSelectedProvider().provider);
}

/** Whether the SELECTED provider can serve a turn right now — credentials
 * cached on-device, or no login needed (faux). The host-side twin of the
 * renderer's hasConnectedProvider gate: feature entry points that dispatch a
 * real turn (delegation) refuse up front through this instead of queueing
 * work a guest's agent can only fail. */
export function isSelectedProviderConnected(): boolean {
  const { provider } = getSelectedProvider();
  return !providerRequiresAuth(provider) || isProviderAuthed(provider);
}

/** Run the selected provider's interactive OAuth flow (no-op for faux). The
 * Settings "Connect" and the reauthenticate path both land here. Provider
 * auth is a FEATURE-level concern — it never gates app entry (#459). */
export async function loginSelectedProvider(): Promise<void> {
  const { provider } = getSelectedProvider();
  if (!providerRequiresAuth(provider)) return;
  await login(provider);
}

// ---------------------------------------------------------------------------
// Settings surface — the Bridge handlers' backing functions.
// ---------------------------------------------------------------------------

/** Snapshot for Settings → AI: the selection plus every offered provider with
 * its connected state and model menu. */
export function getAiProviderSettings(): AiProviderSettings {
  const selected = getSelectedProvider();
  return {
    selected,
    providers: listSupportedProviders().map((entry) => ({
      id: entry.id,
      label: entry.label,
      requiresAuth: entry.auth === "oauth",
      connected: entry.auth === "oauth" ? isProviderAuthed(entry.id) : true,
      defaultModelId: entry.defaultModelId,
      models: listProviderModels(entry.id).map((model) => ({ id: model.id, label: model.name })),
    })),
  };
}

/** Patch the persisted selection (validated against the catalog — see
 * applySelectionPatch for the loud-on-bad-input contract). The caller decides
 * whether a live session needs rolling (app-machine). */
export function setAiProviderConfig(patch: {
  provider?: string;
  modelId?: string;
}): AiProviderSettings {
  getProviderConfig().set(applySelectionPatch(getProviderConfig().get(), patch));
  return getAiProviderSettings();
}

/** Run the OAuth connect flow for `providerId` (not necessarily the selected
 * one — connecting Claude while on OpenAI is fine). Resolves when the OAuth
 * round-trip completes and credentials are in pi's auth.json. */
export async function connectAiProvider(providerId: string): Promise<AiConnectResult> {
  const provider = parseSupportedProvider(providerId);
  if (provider === null) return { ok: false, error: `Unknown AI provider "${providerId}"` };
  if (!providerRequiresAuth(provider)) return { ok: true };
  try {
    await login(provider);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

/** Drop `providerId`'s credentials from pi's auth.json. Disconnecting the
 * SELECTED provider disables AI (turns surface the existing not-authed error
 * path) but the app stays fully usable locally. */
export function disconnectAiProvider(providerId: string): AiProviderSettings {
  const provider = parseSupportedProvider(providerId);
  if (provider === null) throw new Error(`Unknown AI provider "${providerId}"`);
  if (providerRequiresAuth(provider)) logoutProvider(provider);
  return getAiProviderSettings();
}
