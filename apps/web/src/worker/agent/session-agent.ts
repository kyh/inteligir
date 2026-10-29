// The agent a thread's session runs. Production's runs the agent `ant apply` pinned, by id and
// version, so a run is the one applied and a rollback is a version. Every other deployment (a PR's
// preview, the local Worker) declares a connector its workspace's applied agent does not, and that
// agent was applied from another commit, so its sessions run this build's own definition as their
// overrides: its model with its effort (an override replaces the whole model, and one without an
// effort runs at the model's default), its tools, the system prompt this build's agent.md carries,
// and this deployment's own connector under the same server name, so the toolset still names it
// (platform.claude.com/docs/en/managed-agents/sessions, "Override agent configuration").

import type Anthropic from "@anthropic-ai/sdk";

import { CONNECTOR_PATH } from "@repo/contract/cloud/connector";
import { PRODUCTION_CLOUD_ORIGIN } from "@repo/contract/cloud/origin";

import agentFile from "../../../agents/preview/library-agent/agent.md?raw";
import { AGENT_MODEL, agentMcpServers, agentTools } from "./library-agent";

type SessionAgent = Anthropic.Beta.Sessions.SessionCreateParams["agent"];

// ant sends an agent.md's body, trimmed, as the agent's system prompt; every target's is the same
const AGENT_SYSTEM = agentFile.replace(/^---\n[\s\S]*?\n---\n/u, "").trim();

const PRODUCTION_CONNECTOR = `${PRODUCTION_CLOUD_ORIGIN}${CONNECTOR_PATH}`;

export const sessionAgent = (
  agent: { readonly id: string; readonly version: number },
  siteOrigin: string,
): SessionAgent => {
  const connector = `${siteOrigin}${CONNECTOR_PATH}`;
  if (connector === PRODUCTION_CONNECTOR) {
    return { id: agent.id, type: "agent", version: agent.version };
  }
  return {
    id: agent.id,
    mcp_servers: agentMcpServers(connector),
    model: { ...AGENT_MODEL },
    system: AGENT_SYSTEM,
    tools: agentTools(),
    type: "agent_with_overrides",
    version: agent.version,
  };
};
