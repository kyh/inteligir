import { describe, it, expect, vi } from "vitest";
import { AppMachine } from "../app/app-machine";
import type { EffectDeps } from "../app/app-effects";
import type { AppState } from "@repo/bridge/app-state";

vi.mock("@repo/agent/setup", () => ({
  isSetupComplete: vi.fn().mockReturnValue(false),
  seedResources: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@repo/agent/auth", () => ({
  isProviderAuthed: vi.fn().mockReturnValue(false),
  login: vi.fn().mockResolvedValue(undefined),
  logoutProvider: vi.fn(),
  getAuthStorage: vi.fn(),
  resetAuthStorage: vi.fn(),
}));

vi.mock("@repo/agent/agent", () => ({
  Agent: vi.fn(),
}));

function fakeDeps(overrides?: Partial<EffectDeps>): EffectDeps {
  return {
    seedResources: vi.fn().mockResolvedValue(undefined),
    downloadVoiceModel: vi.fn().mockResolvedValue(undefined),
    startAgent: vi.fn().mockResolvedValue(undefined),
    stopAgent: vi.fn().mockResolvedValue(undefined),
    teardownResources: vi.fn(),
    resumeVaultWrites: vi.fn(),
    rehardenAppDir: vi.fn(),
    newSession: vi.fn().mockResolvedValue(undefined),
    reportSetupProgress: vi.fn(),
    ...overrides,
  };
}

describe("AppMachine", () => {
  it("starts in starting by default — a guest, never a login phase", () => {
    const machine = new AppMachine(fakeDeps(), vi.fn());
    expect(machine.getState()).toEqual({ phase: "starting" });
  });

  it("accepts custom initial state", () => {
    const machine = new AppMachine(fakeDeps(), vi.fn(), { phase: "ready", agent: "idle" });
    expect(machine.getState()).toEqual({ phase: "ready", agent: "idle" });
  });

  it("guest boot: SETUP -> setting_up -> seedResources() + startAgent() -> ready, no login", async () => {
    const broadcasts: AppState[] = [];
    const deps = fakeDeps();
    const machine = new AppMachine(deps, (s) => broadcasts.push(s));

    await machine.send({ type: "SETUP" });

    expect(deps.seedResources).toHaveBeenCalledOnce();
    expect(deps.startAgent).toHaveBeenCalledOnce();
    expect(machine.getState()).toEqual({ phase: "ready", agent: "idle" });
    expect(broadcasts).toEqual([{ phase: "setting_up" }, { phase: "ready", agent: "idle" }]);
  });

  it("SETUP failure -> error(setting_up)", async () => {
    const deps = fakeDeps({
      startAgent: vi.fn().mockRejectedValue(new Error("agent broke")),
    });
    const machine = new AppMachine(deps, vi.fn());

    await machine.send({ type: "SETUP" });

    expect(machine.getState()).toEqual({
      phase: "error",
      prev: "setting_up",
      message: "agent broke",
    });

    // RETRY re-runs setup; with a healthy startAgent it completes.
    const healthy = fakeDeps();
    const retryMachine = new AppMachine(healthy, vi.fn(), {
      phase: "error",
      prev: "setting_up",
      message: "agent broke",
    });
    await retryMachine.send({ type: "RETRY" });
    expect(retryMachine.getState()).toEqual({ phase: "ready", agent: "idle" });
  });

  it("RESET_APP_DATA -> stop + teardown + resume writes + re-setup -> ready", async () => {
    const calls: string[] = [];
    const deps = fakeDeps({
      stopAgent: vi.fn().mockImplementation(async () => {
        calls.push("stopAgent");
      }),
      teardownResources: vi.fn().mockImplementation(() => {
        calls.push("teardownResources");
      }),
      resumeVaultWrites: vi.fn().mockImplementation(() => {
        calls.push("resumeVaultWrites");
      }),
      seedResources: vi.fn().mockImplementation(async () => {
        calls.push("seedResources");
      }),
      startAgent: vi.fn().mockImplementation(async () => {
        calls.push("startAgent");
      }),
      rehardenAppDir: vi.fn().mockImplementation(() => {
        calls.push("rehardenAppDir");
      }),
    });
    const machine = new AppMachine(deps, vi.fn(), { phase: "ready", agent: "idle" });

    await machine.send({ type: "RESET_APP_DATA" });

    // Teardown strictly before re-seed, with the write suspension lifted in
    // between — the wipe and the rebuild are one serialized effect — and perms
    // re-hardened last, after the agent (and its 0644 files) exist.
    expect(calls).toEqual([
      "stopAgent",
      "teardownResources",
      "resumeVaultWrites",
      "seedResources",
      "startAgent",
      "rehardenAppDir",
    ]);
    expect(machine.getState()).toEqual({ phase: "ready", agent: "idle" });
  });

  it("RESET_APP_DATA failure surfaces as error(resetting) — RETRY re-runs the RESET", async () => {
    // First stop throws (before the wipe could run); the retry's stop works.
    const stopAgent = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("stop broke"))
      .mockResolvedValue(undefined);
    const deps = fakeDeps({ stopAgent });
    const machine = new AppMachine(deps, vi.fn(), { phase: "ready", agent: "idle" });

    await machine.send({ type: "RESET_APP_DATA" });

    expect(machine.getState()).toEqual({
      phase: "error",
      prev: "resetting",
      message: "stop broke",
    });
    expect(deps.teardownResources).not.toHaveBeenCalled();

    // RETRY from a failed reset re-dispatches the RESET effect itself — the
    // wipe the user asked for finally runs (a plain SETUP would skip it).
    await machine.send({ type: "RETRY" });
    expect(deps.teardownResources).toHaveBeenCalledOnce();
    expect(machine.getState()).toEqual({ phase: "ready", agent: "idle" });
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
    await machine.send({ type: "RESET_APP_DATA" }); // invalid from starting
    expect(machine.getState()).toEqual({ phase: "starting" });
  });

  it("serializes concurrent sends", async () => {
    const deps = fakeDeps({
      seedResources: vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50))),
    });
    const machine = new AppMachine(deps, vi.fn());

    const p1 = machine.send({ type: "SETUP" });
    const p2 = machine.send({ type: "NEW_SESSION" });

    await Promise.all([p1, p2]);

    // SETUP completes first (ready/idle), then NEW_SESSION runs from ready.
    expect(machine.getState()).toEqual({ phase: "ready", agent: "idle" });
    expect(deps.newSession).toHaveBeenCalledOnce();
  });

  it("shutdown prevents further transitions", async () => {
    const deps = fakeDeps();
    const machine = new AppMachine(deps, vi.fn(), { phase: "ready", agent: "idle" });

    await machine.shutdown();

    await machine.send({ type: "RESET_APP_DATA" });
    expect(machine.getState()).toEqual({ phase: "ready", agent: "idle" });
  });
});
