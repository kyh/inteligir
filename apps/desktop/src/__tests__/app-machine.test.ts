import { beforeEach, describe, it, expect, vi } from "vitest";
import { AppMachine } from "@/main/app-machine";
import type { EffectDeps } from "@/main/app-effects";
import { registerSetup, resetSetup } from "@/main/lifecycle";
import type { AppState } from "@/shared/app-state";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

vi.mock("@/agent/setup", () => ({
  Agent: vi.fn(),
  isLoggedIn: vi.fn().mockReturnValue(false),
  isSetupComplete: vi.fn().mockReturnValue(false),
  login: vi.fn().mockResolvedValue(undefined),
  teardownResources: vi.fn(),
}));

vi.mock("@/main/notifications", () => ({
  getNotifications: () => ({ notifyAgentIdle: vi.fn() }),
}));

function fakeDeps(overrides?: Partial<EffectDeps>): EffectDeps {
  return {
    login: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stopAgent: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    teardownResources: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  resetSetup();
});

describe("AppMachine", () => {
  it("starts in logged_out by default", () => {
    const machine = new AppMachine(fakeDeps(), vi.fn());
    expect(machine.getState()).toEqual({ phase: "logged_out" });
  });

  it("accepts custom initial state", () => {
    const machine = new AppMachine(fakeDeps(), vi.fn(), { phase: "logged_in" });
    expect(machine.getState()).toEqual({ phase: "logged_in" });
  });

  it("LOGIN → logging_in → login() → logged_in", async () => {
    const broadcasts: AppState[] = [];
    const deps = fakeDeps();
    const machine = new AppMachine(deps, (s) => broadcasts.push(s));

    await machine.send({ type: "LOGIN" });

    expect(deps.login).toHaveBeenCalledOnce();
    expect(machine.getState()).toEqual({ phase: "logged_in" });
    expect(broadcasts).toEqual([
      { phase: "logging_in" },
      { phase: "logged_in" },
    ]);
  });

  it("LOGIN failure → error state", async () => {
    const deps = fakeDeps({
      login: vi.fn<() => Promise<void>>().mockRejectedValue(new Error("auth failed")),
    });
    const machine = new AppMachine(deps, vi.fn());

    await machine.send({ type: "LOGIN" });

    expect(machine.getState()).toEqual({
      phase: "error",
      prev: "logging_in",
      message: "auth failed",
    });
  });

  it("SETUP runs registered steps and transitions to ready", async () => {
    const seed = vi.fn();
    const install = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    registerSetup({ name: "seed", run: seed });
    registerSetup({ name: "install", run: install });

    const machine = new AppMachine(fakeDeps(), vi.fn(), { phase: "logged_in" });
    await machine.send({ type: "SETUP" });

    expect(seed).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledOnce();
    expect(machine.getState()).toEqual({ phase: "ready", agent: "idle" });
  });

  it("SETUP step failure → error state carries step name", async () => {
    registerSetup({ name: "install-gws", run: () => { throw new Error("boom"); } });

    const machine = new AppMachine(fakeDeps(), vi.fn(), { phase: "logged_in" });
    await machine.send({ type: "SETUP" });

    expect(machine.getState()).toEqual({
      phase: "error",
      prev: "setting_up",
      message: "install-gws: boom",
    });
  });

  it("LOGOUT → logging_out → teardown → logged_out", async () => {
    const deps = fakeDeps();
    const machine = new AppMachine(deps, vi.fn(), { phase: "ready", agent: "idle" });

    await machine.send({ type: "LOGOUT" });

    expect(deps.teardownResources).toHaveBeenCalledOnce();
    expect(machine.getState()).toEqual({ phase: "logged_out" });
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
    await machine.send({ type: "SETUP" });
    expect(machine.getState()).toEqual({ phase: "logged_out" });
  });

  it("serializes concurrent sends", async () => {
    const deps = fakeDeps({
      login: vi.fn<() => Promise<void>>().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 50)),
      ),
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
