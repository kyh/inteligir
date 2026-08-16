// ---------------------------------------------------------------------------
// The one provider a container turn streams through.
//
// It is registered as a CUSTOM provider rather than resolved from pi-ai's
// static model registry, because the Worker — not this image — decides which
// model a user runs on. The registry is a snapshot of what pi-ai knew when it
// was published; the boot payload is what the deployment offers today, and a
// model id the registry has not heard of must still work.
//
// THE CONTAINER HOLDS NO CREDENTIAL. `boot.provider.apiKey` is a placeholder:
// pi refuses to prompt without a configured key, so a value has to exist, and
// it authenticates nothing. Every provider request leaves through the sandbox's
// outbound interception, which runs in the Worker where the user's sealed
// refresh token lives and replaces the Authorization header on the way out
// (apps/web/src/worker/agent/egress.ts). A model with `bash` — and it has one,
// because there is no agent sandbox in the security sense — can read every file
// and environment variable here and find nothing to exfiltrate.
//
// The interceptor still has to know WHOSE credential to mint, and that is what
// the identity header carries: this boot's report token, set on every request
// through pi's provider `headers`. pi merges those into the resolved auth
// headers before the call, so there is nothing per-request to remember. (pi
// also offers a per-request hook — the `before_provider_headers` extension
// event — but the identity is per BOOT, so a static header is the honest shape:
// it cannot be forgotten on a path that skipped the hook.)
// ---------------------------------------------------------------------------

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { join } from "node:path";

import type { ContainerBoot } from "../protocol";

/**
 * Header the sandbox's outbound interception reads to decide whose credential
 * to mint. The literal is re-declared rather than imported: it is owned by
 * `apps/web/src/worker/agent/egress.ts`, and the image must not take a
 * dependency on the Worker's package to run.
 */
const EGRESS_IDENTITY_HEADER = "x-inteligir-sandbox";

/**
 * Model limits this image assumes, because the boot payload names a model and
 * not its shape.
 *
 * They are floors, not truths. `contextWindow` drives pi's auto-compaction and
 * `maxTokens` is the output ceiling it asks the provider for — so a value the
 * provider rejects is worse than one that under-uses the model, and both are
 * set to what every model this deployment offers can honour.
 */
const CONTEXT_WINDOW = 200_000;
const MAX_OUTPUT_TOKENS = 16_384;

/** Cost is not priced here. The Worker bills nothing per turn and nothing in
 * this image reads it; zeros say that rather than inventing rates that would
 * silently go stale. */
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export type ProviderRuntime = {
  readonly runtime: ModelRuntime;
  readonly model: Model<Api>;
};

/**
 * Build the runtime the session streams through.
 *
 * Throws when the registration cannot be composed — an unknown provider id is
 * the realistic case, since the wire protocol pi should speak (`api`) is
 * inherited from pi-ai's built-in entry for that id. A boot that cannot pick a
 * protocol must fail loudly at boot rather than at the first token.
 */
export async function createProviderRuntime(
  boot: ContainerBoot,
  agentDir: string,
): Promise<ProviderRuntime> {
  const { provider, modelId, baseUrl, apiKey } = boot.provider;

  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
    // Nothing about this container should depend on reaching a model catalog:
    // the egress allowlist does not include one, and the model is named.
    allowModelNetwork: false,
  });

  runtime.registerProvider(provider, {
    name: provider,
    baseUrl,
    apiKey,
    headers: { [EGRESS_IDENTITY_HEADER]: boot.reportToken },
    models: [
      {
        id: modelId,
        name: modelId,
        reasoning: false,
        input: ["text", "image"],
        cost: NO_COST,
        contextWindow: CONTEXT_WINDOW,
        maxTokens: MAX_OUTPUT_TOKENS,
      },
    ],
  });
  // pi's prompt gate requires the provider to be registered AND authed. The key
  // is the placeholder again — in memory, never written, and overwritten in
  // flight by the interceptor.
  await runtime.setRuntimeApiKey(provider, apiKey);

  const model = runtime.getModel(provider, modelId);
  if (model === undefined) {
    throw new Error(`the provider registration for "${provider}" produced no model "${modelId}"`);
  }
  return { runtime, model };
}
