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

describe("createIpcHandler", () => {
  it("registers a handler on ipcMain", () => {
    createIpcHandler("test:channel", z.string(), vi.fn());
    expect(mockHandle).toHaveBeenCalledWith("test:channel", expect.any(Function));
  });

  it("parses input and calls fn with typed value", () => {
    const fn = vi.fn().mockReturnValue("result");
    createIpcHandler("ch", z.string(), fn);

    const handler = mockHandle.mock.calls[0][1] as (event: unknown, raw: unknown) => unknown;
    const result = handler({}, "hello");

    expect(fn).toHaveBeenCalledWith("hello");
    expect(result).toBe("result");
  });

  it("throws ZodError on invalid input", () => {
    createIpcHandler("ch", z.string(), vi.fn());

    const handler = mockHandle.mock.calls[0][1] as (event: unknown, raw: unknown) => unknown;

    expect(() => handler({}, 42)).toThrow();
  });
});

describe("createVoidIpcHandler", () => {
  it("registers and calls fn with no args", () => {
    const fn = vi.fn().mockReturnValue({ ok: true });
    createVoidIpcHandler("ch", fn);

    const handler = mockHandle.mock.calls[0][1] as () => unknown;
    const result = handler();

    expect(fn).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true });
  });
});
