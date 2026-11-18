import { agentMockModelOn } from "@repo/service/agent/availability";
import { defineAgent, defineDynamic } from "eve";

// a thread idle this long goes on in a new eve session (@repo/service/agent/agent-sessions)
const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

// not in the gateway's catalog, so its window is given: eve's own mock reports a million
const MOCK_CONTEXT_WINDOW_TOKENS = 1_000_000;

// Whom the agent acts for comes only from the app's token (`channels/eve.ts`), never from the
// conversation. The model is read at every call, so a deployment never answers from the mock; the
// gateway is pinned to Anthropic, whose native search `tools/web_search.ts` takes. The account's
// limits are the app's, so eve's own usage limit is off.
export default defineAgent({
  defaultTools: false,
  limits: { sessionTimeoutMs: SESSION_IDLE_MS, sessionUsage: false },
  model: defineDynamic(async () => {
    if (agentMockModelOn()) {
      const { mockAgentModel } = await import("./lib/mock-model");
      return { model: mockAgentModel, modelContextWindowTokens: MOCK_CONTEXT_WINDOW_TOKENS };
    }
    return {
      model: "anthropic/claude-sonnet-5.5",
      modelOptions: { providerOptions: { gateway: { caching: "auto", only: ["anthropic"] } } },
      reasoning: "medium",
    };
  }),
});
