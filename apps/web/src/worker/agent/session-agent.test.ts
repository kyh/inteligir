import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AGENT_MODEL, AGENT_TOOL_POLICIES } from "./library-agent";
import { sessionAgent } from "./session-agent";

const applied = { id: "agent_011CZkZ8", version: 7 };

// what a session sends to run this build's agent in place of the one applied
const overridesSchema = z.looseObject({
  mcp_servers: z.array(z.looseObject({})),
  model: z.looseObject({}),
  system: z.string(),
  tools: z.array(
    z.looseObject({ configs: z.array(z.looseObject({ name: z.string() })), type: z.string() }),
  ),
  type: z.literal("agent_with_overrides"),
});

describe("the agent a session runs", () => {
  it("is production's applied agent, pinned by its version", () => {
    expect(sessionAgent(applied, "https://inteligir.com")).toEqual({
      id: "agent_011CZkZ8",
      type: "agent",
      version: 7,
    });
  });

  it("is this build's own definition on a preview, at the preview's own connector", () => {
    const preview = "https://pr-912-inteligir-web.example.workers.dev";
    const agent = overridesSchema.parse(sessionAgent(applied, preview));
    expect(agent).toMatchObject({ id: "agent_011CZkZ8", version: 7 });
    expect(agent.mcp_servers).toEqual([
      { name: "library", type: "url", url: `${preview}/connector` },
    ]);
    // an override replaces the whole model, so it carries the effort the agent file sets
    expect(agent.model).toEqual({ effort: AGENT_MODEL.effort, id: AGENT_MODEL.id });
    expect(agent.tools).toEqual([
      expect.objectContaining({ mcp_server_name: "library", type: "mcp_toolset" }),
    ]);
    expect(agent.tools[0]?.configs.map((config) => config.name)).toEqual(
      Object.keys(AGENT_TOOL_POLICIES),
    );
    // the system prompt the agent file carries, trimmed as ant sends it
    expect(agent.system.startsWith("You are the agent built into Inteligir")).toBe(true);
    expect(agent.system).toBe(agent.system.trim());
  });
});
