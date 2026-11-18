// What the agent's rows run on: eve, through the platform, and work that outlasts a response. The
// suites hand their own (`../test-support/fake-agent-platform`).

import { startBackground } from "../background";
import { agentAvailable } from "./availability";
import type { AgentPlatform } from "./platform";
import { deploymentAgentPlatform } from "./platform";

export interface AgentRuntime {
  readonly background: (task: () => Promise<void>, label: string) => void;
  readonly platform: AgentPlatform;
}

// null while the deployment reaches no model, so no turn starts
export const deploymentAgentRuntime = (): AgentRuntime | null =>
  agentAvailable() ? { background: startBackground, platform: deploymentAgentPlatform() } : null;
