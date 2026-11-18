// Every account's agent is the deployment's one (apps/web/agent), its model reached through the
// Vercel AI Gateway, or eve's mock model on a local run.

import { env } from "../env";

// read at every model call, so a deployment never answers from the mock whatever its env says;
// env.ts refuses the flag on Vercel at boot as well
export const agentMockModelOn = (): boolean => env.AGENT_MOCK_MODEL && process.env.VERCEL !== "1";

// on Vercel the gateway takes the deployment's OIDC token; anywhere else, its key
const gatewayReachable = (): boolean =>
  env.AI_GATEWAY_API_KEY !== undefined || process.env.VERCEL === "1";

export const agentAvailable = (): boolean => agentMockModelOn() || gatewayReachable();
