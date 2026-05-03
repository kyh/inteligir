import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  registerSetup,
  registerShutdown,
  registerStartup,
  resetSetup,
  resetShutdown,
  resetStartup,
  runSetup,
  runShutdown,
  runStartup,
} from "@/main/lifecycle";

beforeEach(() => {
  resetStartup();
  resetShutdown();
  resetSetup();
});

describe("startup registry", () => {
  it("runs hooks in registration order", async () => {
    const calls: string[] = [];
    registerStartup({ name: "a", run: () => { calls.push("a"); } });
    registerStartup({ name: "b", run: async () => { calls.push("b"); } });
    registerStartup({ name: "c", run: () => { calls.push("c"); } });

    await runStartup();
    expect(calls).toEqual(["a", "b", "c"]);
  });

  it("propagates errors (caller decides fatality)", async () => {
    registerStartup({ name: "boom", run: () => { throw new Error("nope"); } });
    await expect(runStartup()).rejects.toThrow("nope");
  });
});

describe("shutdown registry", () => {
  it("runs hooks in reverse registration order (LIFO)", async () => {
    const calls: string[] = [];
    registerShutdown({ name: "a", run: () => { calls.push("a"); } });
    registerShutdown({ name: "b", run: () => { calls.push("b"); } });
    registerShutdown({ name: "c", run: () => { calls.push("c"); } });

    await runShutdown();
    expect(calls).toEqual(["c", "b", "a"]);
  });

  it("continues after a failing hook", async () => {
    const calls: string[] = [];
    registerShutdown({ name: "ok-1", run: () => { calls.push("ok-1"); } });
    registerShutdown({ name: "bad", run: () => { throw new Error("boom"); } });
    registerShutdown({ name: "ok-2", run: () => { calls.push("ok-2"); } });

    await runShutdown();
    expect(calls).toEqual(["ok-2", "ok-1"]);
  });

  it("times out a stuck hook and keeps going", async () => {
    const calls: string[] = [];
    registerShutdown({ name: "stuck", run: () => new Promise(() => {}), timeoutMs: 20 });
    registerShutdown({ name: "after", run: () => { calls.push("after"); } });

    // "after" is registered later → runs first (LIFO)
    await runShutdown();
    expect(calls).toEqual(["after"]);
  });
});

describe("setup registry", () => {
  it("runs steps in registration order, returns ok", async () => {
    const calls: string[] = [];
    registerSetup({ name: "a", run: () => { calls.push("a"); } });
    registerSetup({ name: "b", run: async () => { calls.push("b"); } });

    const result = await runSetup();
    expect(calls).toEqual(["a", "b"]);
    expect(result).toEqual({ ok: true });
  });

  it("aborts on first failure and reports step name", async () => {
    const after = vi.fn();
    registerSetup({ name: "ok", run: vi.fn() });
    registerSetup({ name: "install-gws", run: () => { throw new Error("checksum mismatch"); } });
    registerSetup({ name: "after", run: after });

    const result = await runSetup();
    expect(result).toEqual({ ok: false, step: "install-gws", message: "checksum mismatch" });
    expect(after).not.toHaveBeenCalled();
  });
});
