import { beforeEach, describe, expect, it, vi } from "vitest";

// The gateway's only dependency is getAgent(); mock it so we can observe the
// commands reaching the agent.
const { getAgent } = vi.hoisted(() => ({ getAgent: vi.fn() }));
vi.mock("../app/app-machine", () => ({ getAgent }));

type Gateway = typeof import("../app/agent-gateway");

function makeAgent() {
  return {
    sendMessage: vi.fn(async () => {}),
    steer: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
  };
}

describe("agent-gateway", () => {
  let gw: Gateway;

  beforeEach(async () => {
    vi.resetModules();
    getAgent.mockReset();
    gw = await import("../app/agent-gateway");
  });

  it("routes a user_message to sendMessage", async () => {
    const agent = makeAgent();
    getAgent.mockReturnValue(agent);

    await gw.dispatchAgentCommand({ type: "user_message", text: "hi" });

    expect(agent.sendMessage).toHaveBeenCalledWith("hi", undefined);
  });

  it("projects image attachments to pi image content", async () => {
    const agent = makeAgent();
    getAgent.mockReturnValue(agent);

    await gw.dispatchAgentCommand({
      type: "user_message",
      text: "look",
      images: [{ data: "AAA", mimeType: "image/png" }],
    });

    expect(agent.sendMessage).toHaveBeenCalledWith("look", [
      { type: "image", data: "AAA", mimeType: "image/png" },
    ]);
  });

  it("routes steer / follow_up / interrupt to their methods", async () => {
    const agent = makeAgent();
    getAgent.mockReturnValue(agent);

    await gw.dispatchAgentCommand({ type: "steer", text: "s" });
    await gw.dispatchAgentCommand({ type: "follow_up", text: "f" });
    await gw.dispatchAgentCommand({ type: "interrupt" });

    expect(agent.steer).toHaveBeenCalledWith("s", undefined);
    expect(agent.followUp).toHaveBeenCalledWith("f", undefined);
    expect(agent.interrupt).toHaveBeenCalledOnce();
  });

  it("rejects when no agent is live", async () => {
    getAgent.mockReturnValue(null);

    await expect(gw.dispatchAgentCommand({ type: "user_message", text: "x" })).rejects.toThrow(
      "Agent unavailable",
    );
  });
});
