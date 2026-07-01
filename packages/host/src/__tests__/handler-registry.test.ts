import { describe, expect, it, vi } from "vitest";

import { HOST_METHODS, collectHandlers, type HandlerRegistrar } from "../lib/handler-registry";
import { IPC, IPC_METHODS, UPDATE_METHODS } from "@repo/core/ipc-registry";

/** Register a stub for every host method, optionally overriding some. */
function registerAll(overrides: Partial<Record<string, (payload: unknown) => unknown>> = {}) {
  return (handle: HandlerRegistrar): void => {
    for (const method of HOST_METHODS) {
      const fn = overrides[method] ?? vi.fn();
      // Test-only cast: stubs at the mock seam of a per-method-typed registrar.
      handle(method, fn as never);
    }
  };
}

describe("method partitions", () => {
  it("host methods + updater trio cover every renderer-initiated method", () => {
    const invokable = IPC_METHODS.filter((m) => IPC[m].kind !== "event").toSorted();
    expect([...HOST_METHODS, ...UPDATE_METHODS].toSorted()).toEqual(invokable);
  });

  it("registry channels are unique", () => {
    const channels = Object.values(IPC).map((def) => def.channel);
    expect(new Set(channels).size).toBe(channels.length);
  });
});

describe("collectHandlers", () => {
  it("returns a handler for every host method", () => {
    const handlers = collectHandlers(registerAll());
    expect(Object.keys(handlers).toSorted()).toEqual([...HOST_METHODS].toSorted());
  });

  it("throws naming the missing methods when registration is incomplete", () => {
    expect(() =>
      collectHandlers((handle) => {
        registerAll()((method, fn) => {
          if (method !== "getVaultRoot") handle(method, fn);
        });
      }),
    ).toThrow(/missing for: getVaultRoot/);
  });

  it("throws on a duplicate registration", () => {
    expect(() =>
      collectHandlers((handle) => {
        registerAll()(handle);
        handle("getVaultRoot", vi.fn());
      }),
    ).toThrow(/duplicate host handler for "getVaultRoot"/);
  });

  it("validates invoke payloads and passes the typed value through", () => {
    const fn = vi.fn().mockReturnValue("result");
    const handlers = collectHandlers(registerAll({ removeExecutorIntegration: fn }));
    expect(handlers.removeExecutorIntegration("integration-id")).toBe("result");
    expect(fn).toHaveBeenCalledWith("integration-id");
  });

  it("throws on an invalid invoke payload", () => {
    const handlers = collectHandlers(registerAll());
    expect(() => handlers.removeExecutorIntegration(42)).toThrow(/payload validation failed/);
  });

  it("send handlers swallow + log instead of throwing", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const fn = vi.fn(() => {
        throw new Error("boom");
      });
      const handlers = collectHandlers(registerAll({ ttsSend: fn }));
      expect(() => handlers.ttsSend({ text: "hi" })).not.toThrow();
      expect(fn).toHaveBeenCalledWith({ text: "hi" });
      expect(consoleError).toHaveBeenCalled();
      // Invalid payload on a send channel is also swallowed.
      expect(() => handlers.ttsSend(42)).not.toThrow();
    } finally {
      consoleError.mockRestore();
    }
  });
});
