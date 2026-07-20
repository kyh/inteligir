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

import { isProviderAuthed, login, logoutProvider } from "@repo/agent/auth";
import { toErrorMessage } from "@repo/bridge/wire-helpers";
import type { ModelSelection } from "@repo/agent/pi/model";
import type { Api, Model } from "@repo/agent/pi/pi-types";
import type { AiConnectResult, AiProviderSettings } from "@repo/bridge/ai-provider";

import { FAUX_PROVIDER_ID, isFauxAgentEnabled } from "@repo/agent/provider/faux-provider";
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

/** Pair `modelId` with the SELECTED provider — the ghost-text session's
 * fast-model override rides through here so its override follows a provider
 * switch instead of pointing at a foreign registry. Resolution to a pi Model
 * happens inside the PiAgent wrapper at start() (#460). Faux runtime auth
 * (the in-memory key satisfying pi's prompt gate) is asserted inside the
 * wrapper at session start (pi/model.ts::prepareRuntimeForSelection), so a
 * faux selection needs no side effect here. */
export function providerModelSelection(modelId: string): ModelSelection {
  const { provider } = getSelectedProvider();
  return { provider, modelId };
}

/** The selected provider+model pair every default Agent session runs on —
 * passed as the lazy `selectModel` thunk in AgentOptions and resolved to a
 * pi Model inside the PiAgent wrapper at start() (#460: pi-ai's Model type
 * stays inside @repo/agent/pi/*). */
export function agentModelSelection(): ModelSelection {
  return getSelectedProvider();
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
 * path) but the app stays fully usable locally. Async: the 0.80 credential
 * store's delete is a serialized file-locked write, awaited so the returned
 * snapshot reflects the post-delete auth.json. */
export async function disconnectAiProvider(providerId: string): Promise<AiProviderSettings> {
  const provider = parseSupportedProvider(providerId);
  if (provider === null) throw new Error(`Unknown AI provider "${providerId}"`);
  if (providerRequiresAuth(provider)) await logoutProvider(provider);
  return getAiProviderSettings();
}
