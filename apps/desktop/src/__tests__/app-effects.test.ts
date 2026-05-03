import { beforeEach, describe, it, expect, vi } from "vitest";
import { runEffect, type EffectDeps } from "@/main/app-effects";
import { registerSetup, resetSetup } from "@/main/lifecycle";

vi.mock("@/main/session-history", () => ({
  clearResolvedSessionFile: vi.fn(),
}));

function makeDeps(overrides?: Partial<EffectDeps>): EffectDeps {
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

describe("runEffect", () => {
  // ---- LOGIN ----------------------------------------------------------------

  it("LOGIN calls deps.login and returns LOGIN_OK on success", async () => {
    const deps = makeDeps();
    const result = await runEffect("LOGIN", deps);
    expect(deps.login).toHaveBeenCalledOnce();
    expect(result).toEqual({ type: "LOGIN_OK" });
  });

  it("LOGIN returns LOGIN_FAIL when login rejects", async () => {
    const deps = makeDeps({
      login: vi.fn<() => Promise<void>>().mockRejectedValue(new Error("auth failed")),
    });
    const result = await runEffect("LOGIN", deps);
    expect(result).toEqual({ type: "LOGIN_FAIL", message: "auth failed" });
  });

  // ---- SETUP ----------------------------------------------------------------

  it("SETUP runs all registered setup steps and returns SETUP_OK", async () => {
    const step1 = vi.fn();
    const step2 = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    registerSetup({ name: "step-1", run: step1 });
    registerSetup({ name: "step-2", run: step2 });

    const result = await runEffect("SETUP", makeDeps());
    expect(step1).toHaveBeenCalledOnce();
    expect(step2).toHaveBeenCalledOnce();
    expect(result).toEqual({ type: "SETUP_OK" });
  });

  it("SETUP returns SETUP_FAIL with step name when a step throws", async () => {
    registerSetup({ name: "ok", run: vi.fn() });
    registerSetup({ name: "broken", run: () => { throw new Error("seed broke"); } });

    const result = await runEffect("SETUP", makeDeps());
    expect(result).toEqual({ type: "SETUP_FAIL", message: "broken: seed broke" });
  });

  // ---- LOGOUT ---------------------------------------------------------------

  it("LOGOUT calls stopAgent + teardownResources and returns LOGOUT_OK", async () => {
    const deps = makeDeps();
    const result = await runEffect("LOGOUT", deps);
    expect(deps.stopAgent).toHaveBeenCalledOnce();
    expect(deps.teardownResources).toHaveBeenCalledOnce();
    expect(result).toEqual({ type: "LOGOUT_OK" });
  });
});
