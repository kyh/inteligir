import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { deployedEnv as deployed, fakeManagedAgentsApi } from "../test-support/managed-agents-api";
import { managedAgents } from "./managed-agents";

describe("the Managed Agents client", () => {
  it("is none on a deployment without the key, so no agent call is made", () => {
    // the suites bind no key, as a production Worker whose secret was never set
    expect(managedAgents(env)).toBeNull();
    expect(managedAgents({ ...deployed, ANTHROPIC_API_KEY: "" })).toBeNull();
  });

  it("is none while the target's agent is unapplied, its lockfile holding no ids", () => {
    expect(managedAgents({ ...deployed, AGENT_ID: "", AGENT_VERSION: "" })).toBeNull();
    expect(managedAgents({ ...deployed, AGENT_ENVIRONMENT_ID: "" })).toBeNull();
  });

  it("pins the applied agent's version, read from its lockfile's text", () => {
    expect(managedAgents(deployed)).toMatchObject({
      agent: { id: "agent_011CZkZ8", version: 3 },
      environmentId: "env_011CZkZ9",
    });
  });

  it("sends the deployment's key to Anthropic's API, the beta header the SDK's own", async () => {
    const api = fakeManagedAgentsApi();
    const agents = managedAgents(deployed, api.fetch);
    await agents?.client.beta.vaults.create({ display_name: "Inteligir library" });
    const [call] = api.calls;
    expect(call?.path).toBe("/v1/vaults");
    expect(call?.headers.get("authorization")).toBe("Bearer sk-ant-test");
    expect(call?.headers.get("anthropic-beta")).toBe("managed-agents-2026-04-01");
  });
});
