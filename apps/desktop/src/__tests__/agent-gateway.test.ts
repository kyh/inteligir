import { beforeEach, describe, expect, it, vi } from "vitest";

// The gateway's only dependency is getAgent(); mock it so we can observe the
// order and concurrency of calls reaching the agent.
const { getAgent } = vi.hoisted(() => ({ getAgent: vi.fn() }));
vi.mock("@/main/app-machine", () => ({ getAgent }));

type Gateway = typeof import("@/main/dispatch/agent-gateway");

function makeAgent() {
  const started: string[] = [];
  return {
    started,
    sendMessage: vi.fn(async (text: string) => {
      started.push(text);
    }),
    steer: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
  };
}

// Let the microtask-driven drain make progress.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("agent-gateway", () => {
  let gw: Gateway;

  beforeEach(async () => {
    vi.resetModules();
    getAgent.mockReset();
    gw = await import("@/main/dispatch/agent-gateway");
  });

  it("applies a command immediately when no exclusive turn is active", async () => {
    const agent = makeAgent();
    getAgent.mockReturnValue(agent);

    await gw.dispatchAgentCommand({ type: "user_message", text: "hi" });

    expect(agent.sendMessage).toHaveBeenCalledWith("hi", undefined);
  });

  it("queues commands during an exclusive turn and drains them in FIFO order", async () => {
    const agent = makeAgent();
    getAgent.mockReturnValue(agent);

    gw.beginExclusiveTurn();
    const p1 = gw.dispatchAgentCommand({ type: "user_message", text: "a" });
    const p2 = gw.dispatchAgentCommand({ type: "user_message", text: "b" });
    // Nothing reaches the agent while the lock is held.
    expect(agent.sendMessage).not.toHaveBeenCalled();

    gw.endExclusiveTurn();
    await Promise.all([p1, p2]);

    expect(agent.started).toEqual(["a", "b"]);
  });

  it("drains sequentially — the next command waits for the previous to settle", async () => {
    const agent = makeAgent();
    getAgent.mockReturnValue(agent);

    let releaseFirst!: () => void;
    agent.sendMessage.mockImplementation(async (text: string) => {
      agent.started.push(text);
      if (text === "a") await new Promise<void>((r) => (releaseFirst = r));
    });

    gw.beginExclusiveTurn();
    const p1 = gw.dispatchAgentCommand({ type: "user_message", text: "a" });
    const p2 = gw.dispatchAgentCommand({ type: "user_message", text: "b" });
    gw.endExclusiveTurn();

    await flush();
    // "a" is in flight; "b" must not start until "a" resolves.
    expect(agent.started).toEqual(["a"]);

    releaseFirst();
    await Promise.all([p1, p2]);
    expect(agent.started).toEqual(["a", "b"]);
  });

  it("enqueues commands that arrive mid-drain, preserving order", async () => {
    const agent = makeAgent();
    getAgent.mockReturnValue(agent);

    let releaseFirst!: () => void;
    agent.sendMessage.mockImplementation(async (text: string) => {
      agent.started.push(text);
      if (text === "a") await new Promise<void>((r) => (releaseFirst = r));
    });

    gw.beginExclusiveTurn();
    const p1 = gw.dispatchAgentCommand({ type: "user_message", text: "a" });
    gw.endExclusiveTurn();
    await flush(); // drain starts "a" (now in flight, draining === true)

    // Arrives while draining: must queue behind "a", not race ahead.
    const p2 = gw.dispatchAgentCommand({ type: "user_message", text: "c" });
    expect(agent.started).toEqual(["a"]);

    releaseFirst();
    await Promise.all([p1, p2]);
    expect(agent.started).toEqual(["a", "c"]);
  });

  it("reports the agent as reserved while the queue is still draining", async () => {
    const agent = makeAgent();
    getAgent.mockReturnValue(agent);

    let releaseFirst!: () => void;
    agent.sendMessage.mockImplementation(async (text: string) => {
      agent.started.push(text);
      if (text === "a") await new Promise<void>((r) => (releaseFirst = r));
    });

    gw.beginExclusiveTurn();
    const p1 = gw.dispatchAgentCommand({ type: "user_message", text: "a" });
    gw.endExclusiveTurn();
    await flush(); // draining "a" (in flight)

    // The exclusive lock is cleared, but the drain is in progress — a new
    // exclusive turn must still see the agent as reserved.
    expect(gw.isExclusiveTurnActive()).toBe(false);
    expect(gw.isAgentReserved()).toBe(true);

    releaseFirst();
    await p1;
    expect(gw.isAgentReserved()).toBe(false);
  });

  it("rejects the caller's promise when a queued command fails to apply", async () => {
    const agent = makeAgent();
    getAgent.mockReturnValue(agent);
    agent.sendMessage.mockRejectedValueOnce(new Error("boom"));

    gw.beginExclusiveTurn();
    const p = gw.dispatchAgentCommand({ type: "user_message", text: "x" });
    gw.endExclusiveTurn();

    await expect(p).rejects.toThrow("boom");
  });

  it("clears the lock so later commands apply immediately again", async () => {
    const agent = makeAgent();
    getAgent.mockReturnValue(agent);

    gw.beginExclusiveTurn();
    expect(gw.isExclusiveTurnActive()).toBe(true);
    gw.endExclusiveTurn();
    await flush();
    expect(gw.isExclusiveTurnActive()).toBe(false);

    await gw.dispatchAgentCommand({ type: "user_message", text: "after" });
    expect(agent.started).toEqual(["after"]);
  });
});
