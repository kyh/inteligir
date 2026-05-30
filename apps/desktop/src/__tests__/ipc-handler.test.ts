import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Mock electron — vi.mock is hoisted above imports
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from "electron";
import { createIpcHandler, createVoidIpcHandler } from "@/main/lib/ipc-handler";

const mockHandle = vi.mocked(ipcMain.handle);

beforeEach(() => {
  mockHandle.mockClear();
});

function invokeRegistered(...args: unknown[]): unknown {
  const handler = mockHandle.mock.calls[0]?.[1];
  if (typeof handler !== "function") throw new Error("missing ipc handler");
  return Reflect.apply(handler, undefined, [{}, ...args]);
}

describe("createIpcHandler", () => {
  it("registers a handler on ipcMain", () => {
    createIpcHandler("test:channel", z.string(), vi.fn());
    expect(mockHandle).toHaveBeenCalledWith("test:channel", expect.any(Function));
  });

  it("parses input and calls fn with typed value", () => {
    const fn = vi.fn().mockReturnValue("result");
    createIpcHandler("ch", z.string(), fn);

    const result = invokeRegistered("hello");

    expect(fn).toHaveBeenCalledWith("hello");
    expect(result).toBe("result");
  });

  it("throws ZodError on invalid input", () => {
    createIpcHandler("ch", z.string(), vi.fn());

    expect(() => invokeRegistered(42)).toThrow();
  });
});

describe("createVoidIpcHandler", () => {
  it("registers and calls fn with no args", () => {
    const fn = vi.fn().mockReturnValue({ ok: true });
    createVoidIpcHandler("ch", fn);

    const result = invokeRegistered();

    expect(fn).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true });
  });
});
