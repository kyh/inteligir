import { complete } from "@mariozechner/pi-ai";
import type { Api, Model } from "@mariozechner/pi-ai";
import { ModelRegistry, type AuthStorage } from "@mariozechner/pi-coding-agent";

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
  const registry = ModelRegistry.create(authStorage);
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
