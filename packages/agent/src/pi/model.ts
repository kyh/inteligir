import { getModels, getProviders } from "@earendil-works/pi-ai/compat";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

// faux-provider sits in server/provider/ because it is part of the provider
// MENU, but it is pi-shaped (it imports pi-ai directly — see the
// pi-quarantine guard test) and its models exist only on its live
// registration, so resolving it belongs here with the rest of model
// resolution. Same-layer import, no cycle: faux-provider never imports pi/*.
import {
  ensureFauxProvider,
  FAUX_PROVIDER_ID,
  registerFauxRuntimeProvider,
} from "../provider/faux-provider";

type Provider = Parameters<typeof getModels>[0];

/** Neutral (provider, modelId) pair — the shape the provider-config store
 * holds and the ONLY model vocabulary that crosses the agent/ seam (#460).
 * Hosts compose selections; resolution to pi-ai's Model happens inside the
 * PiAgent wrapper at start() (resolveModelSelection), so pi-ai's Model type
 * never leaks past server/pi/*. */
export type ModelSelection = { provider: string; modelId: string };

/**
 * Resolve a neutral selection to pi-ai's Model. Faux resolves through the
 * live registration (its models never enter pi-ai's static registry); every
 * other provider resolves against the static registry. Throws a descriptive
 * error on an unknown provider or model — callers that can't tolerate a
 * throw normalize first (provider-catalog's normalizeSelection). Invoked
 * inside PiAgent.start(), so a bad selection surfaces through the async
 * start() path, never construction.
 */
export function resolveModelSelection(selection: ModelSelection): Model<Api> {
  if (selection.provider === FAUX_PROVIDER_ID) {
    const model = ensureFauxProvider().getModel(selection.modelId);
    if (!model) {
      throw new Error(
        `Model "${FAUX_PROVIDER_ID}/${selection.modelId}" not found on the faux registration`,
      );
    }
    return model;
  }
  const provider = getProviders().find((known) => known === selection.provider);
  if (provider === undefined) {
    throw new Error(`AI provider "${selection.provider}" not found in pi-ai model registry`);
  }
  const model = getModels(provider).find((candidate) => candidate.id === selection.modelId);
  if (!model) {
    throw new Error(
      `Model "${selection.provider}/${selection.modelId}" not found in pi-ai model registry`,
    );
  }
  return model;
}

/**
 * Make sure the session's ModelRuntime can serve `selection`. Builtin
 * providers are already in the runtime's collection; faux (a live, dev-only
 * registration) must be registered on the runtime per session start — 0.80
 * sessions stream exclusively through the runtime's provider set, and its
 * prompt gate requires the provider to be registered AND authed.
 */
export async function prepareRuntimeForSelection(
  runtime: ModelRuntime,
  selection: ModelSelection,
): Promise<void> {
  if (selection.provider === FAUX_PROVIDER_ID) await registerFauxRuntimeProvider(runtime);
}

/** Every model pi-ai's static registry knows for `provider` — the host's
 * source for model pickers (e.g. the ghost-text fast-model setting). */
export function listModels(provider: Provider): Model<Api>[] {
  return [...getModels(provider)];
}
