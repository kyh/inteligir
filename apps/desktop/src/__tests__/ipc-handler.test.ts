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
    handle("deleteTask", fn);
    const result = invokeRegistered("task-id");
    expect(fn).toHaveBeenCalledWith("task-id");
    expect(result).toBe("result");
  });

  it("throws on invalid input", () => {
    handle("deleteTask", vi.fn());
    expect(() => invokeRegistered(42)).toThrow();
  });
});

describe("handle (invoke-void)", () => {
  it("registers and calls fn with no args", () => {
    const fn = vi.fn().mockReturnValue({ tasks: [] });
    handle("listTasks", fn);
    const result = invokeRegistered();
    expect(fn).toHaveBeenCalledOnce();
    expect(result).toEqual({ tasks: [] });
  });
});

describe("handle (send)", () => {
  it("listens on ipcMain.on and parses payload", () => {
    const fn = vi.fn();
    handle("ackWidgetFlush", fn);
    expect(mockOn).toHaveBeenCalledWith(IPC.ackWidgetFlush.channel, expect.any(Function));
    const handler = mockOn.mock.calls[0]?.[1];
    if (typeof handler !== "function") throw new Error("missing ipc on handler");
    Reflect.apply(handler, undefined, [{}, { requestId: "abc", persisted: true }]);
    expect(fn).toHaveBeenCalledWith({ requestId: "abc", persisted: true });
  });
});
