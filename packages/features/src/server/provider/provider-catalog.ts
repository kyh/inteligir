// ---------------------------------------------------------------------------
// Provider catalog — the finite menu of AI providers the app offers, over
// pi-ai's much larger registry. Every provider here has a working end-to-end
// auth story: openai-codex and anthropic ship OAuth login flows in pi
// (AuthStorage.login built-ins); faux needs none and appears only under the
// dev flag. Adding a provider = one entry (id must be a pi-ai KnownProvider
// with an OAuth flow, or its own registration like faux).
//
// Selection normalization lives here as PURE functions over (catalog +
// pi-ai's registry) so the store stays dumb and the logic unit-tests without
// touching disk.
// ---------------------------------------------------------------------------

import { listModels, resolveModel } from "@repo/features/server/pi/model";
import type { Api, Model } from "@repo/features/server/pi/pi-types";

import { ensureFauxProvider, FAUX_PROVIDER_ID, isFauxAgentEnabled } from "./faux-provider";

/** Providers the app can put in front of the user. A store value outside this
 * union is normalized back to the default at read time. */
export type SupportedProviderId = "openai-codex" | "anthropic" | typeof FAUX_PROVIDER_ID;

export type CatalogEntry = {
  readonly id: SupportedProviderId;
  /** User-facing name (the account being connected, not the wire protocol). */
  readonly label: string;
  readonly defaultModelId: string;
  /** "oauth" = pi's interactive login flow; "none" = trivially connected. */
  readonly auth: "oauth" | "none";
};

const OPENAI: CatalogEntry = {
  id: "openai-codex",
  label: "OpenAI",
  defaultModelId: "gpt-5.5",
  auth: "oauth",
};
const CLAUDE: CatalogEntry = {
  id: "anthropic",
  label: "Claude",
  defaultModelId: "claude-sonnet-4-6",
  auth: "oauth",
};
const FAUX: CatalogEntry = {
  id: FAUX_PROVIDER_ID,
  label: "Faux (dev)",
  defaultModelId: "faux-1",
  auth: "none",
};

/** The pre-provider-swap hardcoded pair, kept as the store default so an
 * untouched install behaves exactly as before. */
export const DEFAULT_PROVIDER: CatalogEntry = OPENAI;

export function listSupportedProviders(): CatalogEntry[] {
  return isFauxAgentEnabled() ? [OPENAI, CLAUDE, FAUX] : [OPENAI, CLAUDE];
}

/** Parse an arbitrary provider string (store file, IPC payload) into the
 * supported union — null when unknown (including faux without the flag). */
export function parseSupportedProvider(id: string): SupportedProviderId | null {
  const entry = listSupportedProviders().find((candidate) => candidate.id === id);
  return entry ? entry.id : null;
}

export function catalogEntry(id: SupportedProviderId): CatalogEntry {
  switch (id) {
    case "openai-codex":
      return OPENAI;
    case "anthropic":
      return CLAUDE;
    case FAUX_PROVIDER_ID:
      return FAUX;
  }
}

export function providerRequiresAuth(id: SupportedProviderId): boolean {
  return catalogEntry(id).auth === "oauth";
}

/** Every model the provider can run — pi-ai's static registry, except faux,
 * whose models exist only on its live registration. */
export function listProviderModels(id: SupportedProviderId): Model<Api>[] {
  if (id === FAUX_PROVIDER_ID) return [...ensureFauxProvider().models];
  return listModels(id);
}

/** Resolve one (provider, modelId) to pi-ai's Model. Throws descriptively on
 * an unknown model — callers that can't tolerate a throw normalize first
 * (see normalizeSelection). */
export function resolveProviderModel(id: SupportedProviderId, modelId: string): Model<Api> {
  if (id === FAUX_PROVIDER_ID) {
    const model = ensureFauxProvider().getModel(modelId);
    if (!model) {
      throw new Error(`Model "${FAUX_PROVIDER_ID}/${modelId}" not found on the faux registration`);
    }
    return model;
  }
  return resolveModel(id, modelId);
}

/** Normalize a stored selection at the read boundary: an unsupported provider
 * (hand-edited file, faux persisted without the flag, a provider we dropped)
 * falls back to the default provider+model; a model the provider doesn't know
 * falls back to the provider's default. Never throws — the stored file is
 * app state, not user content, so healing beats failing the boot. */
export function normalizeSelection(stored: { provider: string; modelId: string }): {
  provider: SupportedProviderId;
  modelId: string;
} {
  const provider = parseSupportedProvider(stored.provider);
  if (provider === null) {
    return { provider: DEFAULT_PROVIDER.id, modelId: DEFAULT_PROVIDER.defaultModelId };
  }
  const known = listProviderModels(provider).some((model) => model.id === stored.modelId);
  return { provider, modelId: known ? stored.modelId : catalogEntry(provider).defaultModelId };
}

/** Apply a Settings patch to the current selection. Loud on bad input (the
 * schema-validated UI only offers catalog values, so a miss is a bug or a
 * hand-crafted payload): unknown provider or a modelId the target provider
 * doesn't know throws. A provider switch without an explicit modelId moves to
 * that provider's default model. */
export function applySelectionPatch(
  current: { provider: string; modelId: string },
  patch: { provider?: string; modelId?: string },
): { provider: SupportedProviderId; modelId: string } {
  const base = normalizeSelection(current);
  let provider = base.provider;
  if (patch.provider !== undefined) {
    const parsed = parseSupportedProvider(patch.provider);
    if (parsed === null) throw new Error(`Unknown AI provider "${patch.provider}"`);
    provider = parsed;
  }
  const modelId =
    patch.modelId ??
    (provider === base.provider ? base.modelId : catalogEntry(provider).defaultModelId);
  if (!listProviderModels(provider).some((model) => model.id === modelId)) {
    throw new Error(`Model "${modelId}" is not available for AI provider "${provider}"`);
  }
  return { provider, modelId };
}
