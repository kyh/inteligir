import { startBackground } from "../background";
import { agentAvailable } from "./availability";
import type { AgentPlatform } from "./platform";
import { deploymentAgentPlatform } from "./platform";

export interface AgentRuntime {
  readonly background: (task: () => Promise<void>, label: string) => void;
  readonly platform: AgentPlatform;
}

export const deploymentAgentRuntime = () =>
  (agentAvailable()
    ? { background: startBackground, platform: deploymentAgentPlatform() }
    : null) satisfies AgentRuntime | null;
