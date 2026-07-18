import { describe, it, expect, vi } from "vitest";
import { runEffect, type EffectDeps } from "../app/app-effects";

function makeDeps(overrides?: Partial<EffectDeps>): EffectDeps {
  return {
    seedResources: vi.fn<EffectDeps["seedResources"]>().mockResolvedValue(undefined),
    downloadVoiceModel: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    startAgent: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stopAgent: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    teardownResources: vi.fn(),
    resumeVaultWrites: vi.fn(),
    rehardenAppDir: vi.fn(),
    newSession: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    reportSetupProgress: vi.fn(),
    ...overrides,
  };
}

describe("runEffect", () => {
  // ---- SETUP ----------------------------------------------------------------

  it("SETUP calls deps.seedResources and deps.startAgent, returns SETUP_OK", async () => {
    const deps = makeDeps();
    const result = await runEffect("SETUP", deps);
    expect(deps.seedResources).toHaveBeenCalledOnce();
    expect(deps.startAgent).toHaveBeenCalledOnce();
    // Plain SETUP never tears anything down — that's RESET's job.
    expect(deps.teardownResources).not.toHaveBeenCalled();
    // Perms are re-asserted after the (re)seed, mirroring boot (owner-only).
    expect(deps.rehardenAppDir).toHaveBeenCalledOnce();
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

  // ---- RESET ----------------------------------------------------------------

  it("RESET stops, tears down, resumes vault writes, re-runs setup, re-hardens perms", async () => {
    const deps = makeDeps();
    const result = await runEffect("RESET", deps);
    expect(deps.stopAgent).toHaveBeenCalledOnce();
    expect(deps.teardownResources).toHaveBeenCalledOnce();
    expect(deps.resumeVaultWrites).toHaveBeenCalledOnce();
    expect(deps.seedResources).toHaveBeenCalledOnce();
    expect(deps.startAgent).toHaveBeenCalledOnce();
    expect(deps.rehardenAppDir).toHaveBeenCalledOnce();
    expect(result).toEqual({ type: "SETUP_OK" });
  });

  it("RESET returns SETUP_FAIL when stopAgent rejects (no throw out of the effect)", async () => {
    const deps = makeDeps({
      stopAgent: vi.fn<() => Promise<void>>().mockRejectedValue(new Error("stop broke")),
    });
    const result = await runEffect("RESET", deps);
    expect(result).toEqual({ type: "SETUP_FAIL", message: "stop broke" });
  });

  it("RESET returns SETUP_FAIL when teardownResources throws", async () => {
    const deps = makeDeps({
      teardownResources: vi.fn(() => {
        throw new Error("rm failed");
      }),
    });
    const result = await runEffect("RESET", deps);
    expect(result).toEqual({ type: "SETUP_FAIL", message: "rm failed" });
  });

  it("RESET resumes vault writes even when teardownResources throws (no wedged suspension)", async () => {
    // teardownResources suspends writes THEN wipes the dir; a throw from the
    // wipe (EBUSY on a lingering handle) must not leave writes suspended, or
    // the app reaches ready with every autosave silently failing.
    const deps = makeDeps({
      teardownResources: vi.fn(() => {
        throw new Error("EBUSY: rm failed after suspend");
      }),
    });
    const result = await runEffect("RESET", deps);
    expect(result).toEqual({ type: "SETUP_FAIL", message: "EBUSY: rm failed after suspend" });
    // The finally lifted the suspension despite the throw.
    expect(deps.resumeVaultWrites).toHaveBeenCalledOnce();
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
