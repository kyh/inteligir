import { describe, it, expect, vi } from "vitest";
import { AppMachine } from "../app/app-machine";
import type { EffectDeps } from "../app/app-effects";
import type { AppState } from "@repo/features/app-state";

vi.mock("../agent/setup", () => ({
  isSetupComplete: vi.fn().mockReturnValue(false),
  seedResources: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../agent/auth", () => ({
  isProviderAuthed: vi.fn().mockReturnValue(false),
  login: vi.fn().mockResolvedValue(undefined),
  logoutProvider: vi.fn(),
  getAuthStorage: vi.fn(),
  resetAuthStorage: vi.fn(),
}));

vi.mock("../agent/agent", () => ({
  Agent: vi.fn(),
}));

function fakeDeps(overrides?: Partial<EffectDeps>): EffectDeps {
  return {
    login: vi.fn().mockResolvedValue(undefined),
    seedResources: vi.fn().mockResolvedValue(undefined),
    downloadVoiceModel: vi.fn().mockResolvedValue(undefined),
    startAgent: vi.fn().mockResolvedValue(undefined),
    stopAgent: vi.fn().mockResolvedValue(undefined),
    teardownResources: vi.fn(),
    newSession: vi.fn().mockResolvedValue(undefined),
    reportSetupProgress: vi.fn(),
    ...overrides,
  };
}

describe("AppMachine", () => {
  it("starts in logged_out by default", () => {
    const machine = new AppMachine(fakeDeps(), vi.fn());
    expect(machine.getState()).toEqual({ phase: "logged_out" });
  });

  it("accepts custom initial state", () => {
    const machine = new AppMachine(fakeDeps(), vi.fn(), { phase: "logged_in" });
    expect(machine.getState()).toEqual({ phase: "logged_in" });
  });

  it("LOGIN -> logging_in -> login() -> logged_in", async () => {
    const broadcasts: AppState[] = [];
    const deps = fakeDeps();
    const machine = new AppMachine(deps, (s) => broadcasts.push(s));

    await machine.send({ type: "LOGIN" });

    expect(deps.login).toHaveBeenCalledOnce();
    expect(machine.getState()).toEqual({ phase: "logged_in" });
    expect(broadcasts).toEqual([{ phase: "logging_in" }, { phase: "logged_in" }]);
  });

  it("LOGIN failure -> error state", async () => {
    const deps = fakeDeps({
      login: vi.fn().mockRejectedValue(new Error("auth failed")),
    });
    const machine = new AppMachine(deps, vi.fn());

    await machine.send({ type: "LOGIN" });

    expect(machine.getState()).toEqual({
      phase: "error",
      prev: "logging_in",
      message: "auth failed",
    });
  });

  it("SETUP -> setting_up -> seedResources() + startAgent() -> ready", async () => {
    const deps = fakeDeps();
    const machine = new AppMachine(deps, vi.fn(), { phase: "logged_in" });

    await machine.send({ type: "SETUP" });

    expect(deps.seedResources).toHaveBeenCalledOnce();
    expect(deps.startAgent).toHaveBeenCalledOnce();
    expect(machine.getState()).toEqual({ phase: "ready", agent: "idle" });
  });

  it("LOGOUT -> logging_out -> teardown -> logged_out", async () => {
    const deps = fakeDeps();
    const machine = new AppMachine(deps, vi.fn(), { phase: "ready", agent: "idle" });

    await machine.send({ type: "LOGOUT" });

    expect(deps.teardownResources).toHaveBeenCalledOnce();
    expect(machine.getState()).toEqual({ phase: "logged_out" });
  });

  it("LOGOUT failure surfaces as error instead of wedging in logging_out", async () => {
    // First attempt rejects, the retry succeeds.
    const stopAgent = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("stop broke"))
      .mockResolvedValue(undefined);
    const machine = new AppMachine(fakeDeps({ stopAgent }), vi.fn(), {
      phase: "ready",
      agent: "idle",
    });

    await machine.send({ type: "LOGOUT" });

    expect(machine.getState()).toEqual({
      phase: "error",
      prev: "logging_out",
      message: "stop broke",
    });

    // RETRY re-runs the logout; with a healthy stopAgent it now completes.
    await machine.send({ type: "RETRY" });
    expect(machine.getState()).toEqual({ phase: "logged_out" });
  });

  it("NEW_SESSION failure surfaces as error instead of ready-with-no-agent", async () => {
    const deps = fakeDeps({
      newSession: vi.fn().mockRejectedValue(new Error("restart broke")),
    });
    const machine = new AppMachine(deps, vi.fn(), { phase: "ready", agent: "idle" });

    await machine.send({ type: "NEW_SESSION" });

    expect(machine.getState()).toEqual({
      phase: "error",
      prev: "ready",
      message: "restart broke",
    });
  });

  it("AGENT_START/AGENT_END toggle busy/idle", async () => {
    const machine = new AppMachine(fakeDeps(), vi.fn(), { phase: "ready", agent: "idle" });

    await machine.send({ type: "AGENT_START" });
    expect(machine.getState()).toEqual({ phase: "ready", agent: "busy" });

    await machine.send({ type: "AGENT_END" });
    expect(machine.getState()).toEqual({ phase: "ready", agent: "idle" });
  });

  it("ignores invalid events", async () => {
    const machine = new AppMachine(fakeDeps(), vi.fn());
    await machine.send({ type: "SETUP" }); // invalid from logged_out
    expect(machine.getState()).toEqual({ phase: "logged_out" });
  });

  it("serializes concurrent sends", async () => {
    const deps = fakeDeps({
      login: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50))),
    });
    const machine = new AppMachine(deps, vi.fn());

    const p1 = machine.send({ type: "LOGIN" });
    const p2 = machine.send({ type: "SETUP" });

    await Promise.all([p1, p2]);

    expect(machine.getState()).toEqual({ phase: "ready", agent: "idle" });
  });

  it("shutdown prevents further transitions", async () => {
    const deps = fakeDeps();
    const machine = new AppMachine(deps, vi.fn(), { phase: "ready", agent: "idle" });

    await machine.shutdown();

    await machine.send({ type: "LOGOUT" });
    expect(machine.getState()).toEqual({ phase: "ready", agent: "idle" });
  });
});
