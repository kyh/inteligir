import { getModels } from "@mariozechner/pi-ai";
import type { Api, Model } from "@mariozechner/pi-ai";

/**
 * Resolve a model from pi-ai's static registry. Throws a descriptive error
 * if the (provider, modelId) pair was not found — surfaced in the UI as a
 * fatal startup error.
 *
 * Generic over `Provider` so callers (e.g. `getModel("openai-codex", "gpt-5.5")`)
 * preserve the provider literal for downstream type narrowing.
 */
export function resolveModel<Provider extends Parameters<typeof getModels>[0]>(
  provider: Provider,
  modelId: string,
): Model<Api> {
  const model = getModels(provider).find((candidate) => candidate.id === modelId);
  if (!model) {
    throw new Error(`Model "${String(provider)}/${modelId}" not found in pi-ai model registry`);
  }
  return model;
}
