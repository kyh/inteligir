import { describe, it, expect, vi } from "vitest";
import { runEffect, type EffectDeps } from "../app/app-effects";

function makeDeps(overrides?: Partial<EffectDeps>): EffectDeps {
  return {
    login: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    seedResources: vi.fn<EffectDeps["seedResources"]>().mockResolvedValue(undefined),
    downloadVoiceModel: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    startAgent: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stopAgent: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    teardownResources: vi.fn(),
    newSession: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    reportSetupProgress: vi.fn(),
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

  it("SETUP calls deps.seedResources and deps.startAgent, returns SETUP_OK", async () => {
    const deps = makeDeps();
    const result = await runEffect("SETUP", deps);
    expect(deps.seedResources).toHaveBeenCalledOnce();
    expect(deps.startAgent).toHaveBeenCalledOnce();
    expect(result).toEqual({ type: "SETUP_OK" });
  });

  it("SETUP returns SETUP_FAIL when seedResources rejects", async () => {
    const deps = makeDeps({
      seedResources: vi
        .fn<EffectDeps["seedResources"]>()
        .mockRejectedValue(new Error("seed broke")),
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

  it("LOGOUT returns LOGOUT_FAIL when stopAgent rejects (no throw out of the effect)", async () => {
    const deps = makeDeps({
      stopAgent: vi.fn<() => Promise<void>>().mockRejectedValue(new Error("stop broke")),
    });
    const result = await runEffect("LOGOUT", deps);
    expect(result).toEqual({ type: "LOGOUT_FAIL", message: "stop broke" });
  });

  it("LOGOUT returns LOGOUT_FAIL when teardownResources throws", async () => {
    const deps = makeDeps({
      teardownResources: vi.fn(() => {
        throw new Error("rm failed");
      }),
    });
    const result = await runEffect("LOGOUT", deps);
    expect(result).toEqual({ type: "LOGOUT_FAIL", message: "rm failed" });
  });

  // ---- NEW_SESSION ------------------------------------------------------------

  it("NEW_SESSION calls deps.newSession and returns NEW_SESSION_OK", async () => {
    const deps = makeDeps();
    const result = await runEffect("NEW_SESSION", deps);
    expect(deps.newSession).toHaveBeenCalledOnce();
    expect(result).toEqual({ type: "NEW_SESSION_OK" });
  });

  it("NEW_SESSION returns NEW_SESSION_FAIL when newSession rejects", async () => {
    const deps = makeDeps({
      newSession: vi.fn<() => Promise<void>>().mockRejectedValue(new Error("restart broke")),
    });
    const result = await runEffect("NEW_SESSION", deps);
    expect(result).toEqual({ type: "NEW_SESSION_FAIL", message: "restart broke" });
  });
});
