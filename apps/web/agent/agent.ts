import { AGENT_MODEL_ID, EVE_SESSION_IDLE_MS } from "@repo/service/agent/agent-model";
import { agentMockModelOn } from "@repo/service/agent/availability";
import { defineAgent, defineDynamic } from "eve";

const MOCK_CONTEXT_WINDOW_TOKENS = 1_000_000;

export default defineAgent({
  defaultTools: false,
  limits: { sessionTimeoutMs: EVE_SESSION_IDLE_MS, sessionUsage: false },
  model: defineDynamic(async () => {
    if (agentMockModelOn()) {
      const { mockAgentModel } = await import("./lib/mock-model");

      return { model: mockAgentModel, modelContextWindowTokens: MOCK_CONTEXT_WINDOW_TOKENS };
    }

    return {
      model: AGENT_MODEL_ID,
      modelOptions: { providerOptions: { gateway: { caching: "auto", only: ["anthropic"] } } },
      reasoning: "medium",
    };
  }),
});
