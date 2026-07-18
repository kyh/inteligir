import { beforeEach, describe, expect, it, vi } from "vitest";

// The gateway depends on getAgent() + getAppState(); mock both so we can
// observe the commands reaching the agent and drive the phase gate.
const { getAgent, getAppState } = vi.hoisted(() => ({
  getAgent: vi.fn(),
  getAppState: vi.fn(),
}));
vi.mock("../app/app-machine", () => ({ getAgent, getAppState }));

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
    getAppState.mockReset();
    getAppState.mockReturnValue({ phase: "ready", agent: "idle" });
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

  it("rejects outside ready even while the old agent is still published (RESET teardown window)", async () => {
    // During RESET the machine flips to setting_up BEFORE the effect stops the
    // agent, so getAgent() still returns the doomed instance — the phase gate
    // must reject rather than submit into the teardown.
    const agent = makeAgent();
    getAgent.mockReturnValue(agent);
    getAppState.mockReturnValue({ phase: "setting_up" });

    await expect(gw.dispatchAgentCommand({ type: "user_message", text: "x" })).rejects.toThrow(
      "Agent unavailable",
    );
    expect(agent.sendMessage).not.toHaveBeenCalled();
  });
});
