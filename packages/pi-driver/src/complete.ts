import { complete } from "@mariozechner/pi-ai";
import type { Api, Model } from "@mariozechner/pi-ai";
import { ModelRegistry, type AuthStorage } from "@mariozechner/pi-coding-agent";

// ModelRegistry.create reads + parses models.json from disk; cache one per
// AuthStorage so repeated one-shot completions don't re-read it each call.
// Keyed weakly so a discarded AuthStorage (e.g. after logout) is collectable.
const registryCache = new WeakMap<AuthStorage, ModelRegistry>();

function registryFor(authStorage: AuthStorage): ModelRegistry {
  let registry = registryCache.get(authStorage);
  if (!registry) {
    registry = ModelRegistry.create(authStorage);
    registryCache.set(authStorage, registry);
  }
  return registry;
}

/**
 * One-shot model completion outside any agent session. Resolves credentials
 * for `model` via a ModelRegistry over `authStorage`, runs a single
 * user-message completion, and returns the concatenated text blocks.
 *
 * Throws if no credentials are configured (e.g. the user is logged out) —
 * callers surface that as a tool/action error.
 */
export async function completeText(
  authStorage: AuthStorage,
  model: Model<Api>,
  prompt: string,
  system?: string,
): Promise<string> {
  const registry = registryFor(authStorage);
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error);
  const result = await complete(
    model,
    {
      systemPrompt: system,
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    },
    { apiKey: auth.apiKey, headers: auth.headers },
  );
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}
