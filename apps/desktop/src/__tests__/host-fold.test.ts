import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake ipcMain records registrations so the fold can be spun without an
// Electron process.
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

import { ipcMain } from "electron";

import { foldHostIntoIpc } from "@/main/host-fold";
import { HOST_METHODS } from "@repo/host/lib/handler-registry";
import type { Host } from "@repo/host/create-host";
import { IPC } from "@repo/core/ipc-registry";

const mockHandle = vi.mocked(ipcMain.handle);
const mockOn = vi.mocked(ipcMain.on);

function fakeHost(): Host & { handlerCalls: Map<string, unknown[]> } {
  const handlerCalls = new Map<string, unknown[]>();
  const handlers: Record<string, (raw: unknown) => unknown> = {};
  for (const method of HOST_METHODS) {
    handlers[method] = (raw: unknown) => {
      handlerCalls.set(method, [raw]);
      return `${method}-result`;
    };
  }
  return {
    handlerCalls,
    handlers: handlers as Host["handlers"],
    events: { onAny: vi.fn().mockReturnValue(() => {}) },
    capabilities: { canPickVault: true, canSelfUpdate: false },
    start: vi.fn(),
    dispose: vi.fn(),
  };
}

beforeEach(() => {
  mockHandle.mockClear();
  mockOn.mockClear();
});

describe("foldHostIntoIpc", () => {
  it("registers every host method on its registry channel with the right mechanism", () => {
    foldHostIntoIpc(fakeHost());

    const expectedInvoke = HOST_METHODS.filter((m) => IPC[m].kind !== "send")
      .map((m) => IPC[m].channel)
      .toSorted();
    const expectedSend = HOST_METHODS.filter((m) => IPC[m].kind === "send")
      .map((m) => IPC[m].channel)
      .toSorted();

    expect(mockHandle.mock.calls.map(([channel]) => channel).toSorted()).toEqual(expectedInvoke);
    expect(mockOn.mock.calls.map(([channel]) => channel).toSorted()).toEqual(expectedSend);
  });

  it("passes the raw wire payload straight to the host handler", () => {
    const host = fakeHost();
    foldHostIntoIpc(host);

    const call = mockHandle.mock.calls.find(([channel]) => channel === IPC.readVaultDoc.channel);
    if (!call) throw new Error("readVaultDoc not registered");
    const registered = call[1];
    const result = Reflect.apply(registered, undefined, [{}, { path: "notes.md" }]);

    expect(host.handlerCalls.get("readVaultDoc")).toEqual([{ path: "notes.md" }]);
    expect(result).toBe("readVaultDoc-result");
  });

  it("subscribes to host events for window forwarding", () => {
    const host = fakeHost();
    foldHostIntoIpc(host);
    expect(host.events.onAny).toHaveBeenCalledTimes(1);
  });
});
