import { describe, it, expect, vi } from "vitest";
import { runEffect, type EffectDeps } from "@/main/app-effects";

function makeDeps(overrides?: Partial<EffectDeps>): EffectDeps {
  return {
    login: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    seedResources: vi.fn(),
    installGws: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    installAgentBrowser: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    startAgent: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stopAgent: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    teardownResources: vi.fn(),
    newSession: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  };
}

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

  it("SETUP installs CLIs and returns SETUP_OK", async () => {
    const deps = makeDeps();
    const result = await runEffect("SETUP", deps);
    expect(deps.seedResources).toHaveBeenCalledOnce();
    expect(deps.installGws).toHaveBeenCalledOnce();
    expect(deps.installAgentBrowser).toHaveBeenCalledOnce();
    expect(result).toEqual({ type: "SETUP_OK" });
  });

  it("SETUP returns SETUP_FAIL when seedResources throws", async () => {
    const deps = makeDeps({
      seedResources: vi.fn().mockImplementation(() => {
        throw new Error("seed broke");
      }),
    });
    const result = await runEffect("SETUP", deps);
    expect(result).toEqual({ type: "SETUP_FAIL", message: "seed broke" });
  });

  // ---- LOGOUT ---------------------------------------------------------------

  it("LOGOUT calls deps.teardownResources and returns LOGOUT_OK", async () => {
    const deps = makeDeps();
    const result = await runEffect("LOGOUT", deps);
    expect(deps.teardownResources).toHaveBeenCalledOnce();
    expect(result).toEqual({ type: "LOGOUT_OK" });
  });
});
