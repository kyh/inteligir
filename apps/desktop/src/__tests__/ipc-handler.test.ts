import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock electron — vi.mock is hoisted above imports
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

import { ipcMain } from "electron";
import { handle } from "@/main/lib/ipc-handler";
import { IPC } from "@/shared/ipc-registry";

const mockHandle = vi.mocked(ipcMain.handle);
const mockOn = vi.mocked(ipcMain.on);

beforeEach(() => {
  mockHandle.mockClear();
  mockOn.mockClear();
});

function invokeRegistered(...args: unknown[]): unknown {
  const handler = mockHandle.mock.calls[0]?.[1];
  if (typeof handler !== "function") throw new Error("missing ipc handler");
  return Reflect.apply(handler, undefined, [{}, ...args]);
}

describe("handle (invoke)", () => {
  it("registers a handler on the registry's channel", () => {
    handle("transition", vi.fn());
    expect(mockHandle).toHaveBeenCalledWith(IPC.transition.channel, expect.any(Function));
  });

  it("parses input and calls fn with typed value", () => {
    const fn = vi.fn().mockReturnValue("result");
    handle("removeExecutorIntegration", fn);
    const result = invokeRegistered("integration-id");
    expect(fn).toHaveBeenCalledWith("integration-id");
    expect(result).toBe("result");
  });

  it("throws on invalid input", () => {
    handle("removeExecutorIntegration", vi.fn());
    expect(() => invokeRegistered(42)).toThrow();
  });
});

describe("handle (invoke-void)", () => {
  it("registers and calls fn with no args", () => {
    const fn = vi.fn().mockReturnValue([]);
    handle("listVault", fn);
    const result = invokeRegistered();
    expect(fn).toHaveBeenCalledOnce();
    expect(result).toEqual([]);
  });
});

describe("handle (send)", () => {
  it("listens on ipcMain.on and parses payload", () => {
    const fn = vi.fn();
    handle("ttsSend", fn);
    expect(mockOn).toHaveBeenCalledWith(IPC.ttsSend.channel, expect.any(Function));
    const handler = mockOn.mock.calls[0]?.[1];
    if (typeof handler !== "function") throw new Error("missing ipc on handler");
    Reflect.apply(handler, undefined, [{}, { text: "hi" }]);
    expect(fn).toHaveBeenCalledWith({ text: "hi" });
  });
});
