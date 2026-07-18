// ---------------------------------------------------------------------------
// Provider service — the host's one answer to "which provider+model is the
// agent on, and is it usable?". Glues the dumb store (provider-config) to the
// pure normalization/resolution logic (provider-catalog) and pi's on-device
// credential store (agent/auth). Every Agent construction site resolves its
// model through here, so switching providers in Settings takes effect on the
// next session start — no restart-time const anywhere.
// ---------------------------------------------------------------------------

import { getAuthStorage, isProviderAuthed, login, logoutProvider } from "../agent/auth";
import { toErrorMessage } from "@repo/features/ipc";
import type { Api, Model } from "@repo/features/server/pi/pi-types";
import type { AiConnectResult, AiProviderSettings } from "@repo/features/ai-provider";

import { FAUX_PROVIDER_ID, isFauxAgentEnabled } from "./faux-provider";
import {
  applySelectionPatch,
  catalogEntry,
  listProviderModels,
  listSupportedProviders,
  normalizeSelection,
  parseSupportedProvider,
  providerRequiresAuth,
  resolveProviderModel,
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

/** Resolve `modelId` against the SELECTED provider — the ghost-text session's
 * fast-model override rides through here so its override follows a provider
 * switch instead of pointing at a foreign registry. */
export function resolveModelForSelectedProvider(modelId: string): Model<Api> {
  const { provider } = getSelectedProvider();
  if (provider === FAUX_PROVIDER_ID) {
    // pi's prompt gate requires SOME auth for the model's provider; a runtime
    // key (never persisted) satisfies it and the faux stream ignores the value.
    // Re-asserted on every resolution because logout rebuilds the AuthStorage.
    getAuthStorage().setRuntimeApiKey(FAUX_PROVIDER_ID, "faux-dev-key");
  }
  return resolveProviderModel(provider, modelId);
}

/** The selected provider+model as a pi Model — what every default Agent
 * session runs on. Passed as the lazy `resolveModel` thunk in AgentOptions. */
export function resolveSelectedModel(): Model<Api> {
  return resolveModelForSelectedProvider(getSelectedProvider().modelId);
}

/** Models the selected provider can run (the ghost-text settings picker). */
export function listSelectedProviderModels(): Model<Api>[] {
  return listProviderModels(getSelectedProvider().provider);
}

/** Whether the selected provider can serve a turn right now: faux always can;
 * OAuth providers need cached credentials. The app-machine's initial
 * logged_in/logged_out phase keys off this. */
export function isSelectedProviderAuthed(): boolean {
  const { provider } = getSelectedProvider();
  if (!providerRequiresAuth(provider)) return true;
  return isProviderAuthed(provider);
}

/** Run the selected provider's interactive OAuth flow (no-op for faux). The
 * app-machine's LOGIN effect and the Settings "Connect" both land here. */
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
