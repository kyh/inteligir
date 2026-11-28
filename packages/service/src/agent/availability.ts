import { env } from "../env";

export const agentMockModelOn = () => env.AGENT_MOCK_MODEL && process.env.VERCEL !== "1";

export const gatewayReachable = () =>
  env.AI_GATEWAY_API_KEY !== undefined || process.env.VERCEL === "1";

export const agentAvailable = () => agentMockModelOn() || gatewayReachable();
