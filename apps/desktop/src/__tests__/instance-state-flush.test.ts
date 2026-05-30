import { describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  type IpcEvent = { sender: { id: number } };
  type IpcListener = (event: IpcEvent, payload: unknown) => void;
  type FakeWindow = {
    isDestroyed: () => boolean;
    webContents: { id: number; send: (channel: string, payload: unknown) => void };
  };
  type SentMessage = { webContentsId: number; channel: string; payload: unknown };

  const windows: FakeWindow[] = [];
  const sent: SentMessage[] = [];
  const listeners = new Map<string, Set<IpcListener>>();

  return {
    windows,
    sent,
    reset: () => {
      windows.splice(0);
      sent.splice(0);
      listeners.clear();
    },
    listenerCount: (channel: string) => listeners.get(channel)?.size ?? 0,
    emit: (channel: string, senderId: number, payload: unknown) => {
      for (const listener of listeners.get(channel) ?? []) {
        listener({ sender: { id: senderId } }, payload);
      }
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => windows),
    },
    ipcMain: {
      on: vi.fn((channel: string, listener: IpcListener) => {
        const current = listeners.get(channel) ?? new Set<IpcListener>();
        current.add(listener);
        listeners.set(channel, current);
      }),
      removeListener: vi.fn((channel: string, listener: IpcListener) => {
        listeners.get(channel)?.delete(listener);
      }),
    },
  };
});

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
  ipcMain: electronMock.ipcMain,
}));

import { flushInstanceState, registerInstanceFlush } from "@/renderer/shell/instance-state-flush";
import { flushRendererInstance } from "@/main/lib/widget-flush";
import { IPC_CHANNELS } from "@/shared/ipc";

function addWindow(id: number): void {
  electronMock.windows.push({
    isDestroyed: () => false,
    webContents: {
      id,
      send: (channel, payload) => {
        electronMock.sent.push({ webContentsId: id, channel, payload });
      },
    },
  });
}

function requestId(index: number): string {
  const message = electronMock.sent[index];
  if (!message) throw new Error("missing sent message");
  const payload = message.payload as { requestId?: unknown };
  if (typeof payload.requestId !== "string") throw new Error("missing requestId");
  return payload.requestId;
}

function missingFlushResolver(): void {
  throw new Error("flush resolver missing");
}

describe("instance-state-flush", () => {
  it("flushInstanceState resolves true immediately when no viewer is registered", async () => {
    await expect(flushInstanceState("nope")).resolves.toBe(true);
  });

  it("flushInstanceState awaits the registered flush before resolving", async () => {
    let resolveFlush: (value: boolean) => void = missingFlushResolver;
    const flushed = vi.fn(
      () =>
        new Promise<boolean>((r) => {
          resolveFlush = r;
        }),
    );
    const unregister = registerInstanceFlush("a", flushed);

    let result: boolean | null = null;
    const pending = flushInstanceState("a").then((value) => {
      result = value;
      return value;
    });
    await Promise.resolve();
    expect(flushed).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
    resolveFlush(true);
    await pending;
    expect(result).toBe(true);
    unregister();
  });

  it("propagates a failed flush as false", async () => {
    const unregister = registerInstanceFlush("a-fail", vi.fn(async () => false));
    await expect(flushInstanceState("a-fail")).resolves.toBe(false);
    unregister();
  });

  it("the most-recently-registered flush wins (one viewer per instance)", async () => {
    const first = vi.fn(async () => true);
    const second = vi.fn(async () => true);
    const unregister1 = registerInstanceFlush("b", first);
    const unregister2 = registerInstanceFlush("b", second);
    await flushInstanceState("b");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unregister1();
    unregister2();
  });

  it("unregistering only clears the entry when it still owns the slot", async () => {
    const first = vi.fn(async () => true);
    const second = vi.fn(async () => true);
    const unregister1 = registerInstanceFlush("c", first);
    registerInstanceFlush("c", second);
    // First viewer unmounts after second already replaced it — should be a no-op.
    unregister1();
    await flushInstanceState("c");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe("flushRendererInstance (main → renderer round-trip)", () => {
  it("waits for every targeted renderer window to ack", async () => {
    electronMock.reset();
    addWindow(1);
    addWindow(2);

    let resolved: boolean | null = null;
    const pending = flushRendererInstance("instance", 1000).then((result) => {
      resolved = result;
      return result;
    });
    await Promise.resolve();

    expect(electronMock.sent.map((message) => message.webContentsId)).toEqual([1, 2]);
    const id = requestId(0);
    electronMock.emit(IPC_CHANNELS.SHELL_FLUSH_ACK, 1, { requestId: id, persisted: true });
    await Promise.resolve();
    expect(resolved).toBeNull();

    electronMock.emit(IPC_CHANNELS.SHELL_FLUSH_ACK, 2, { requestId: id, persisted: true });
    await expect(pending).resolves.toBe(true);
    expect(electronMock.listenerCount(IPC_CHANNELS.SHELL_FLUSH_ACK)).toBe(0);
  });

  it("resolves false when any window acks with persisted=false", async () => {
    electronMock.reset();
    addWindow(1);
    addWindow(2);

    const pending = flushRendererInstance("instance", 1000);
    await Promise.resolve();
    const id = requestId(0);
    electronMock.emit(IPC_CHANNELS.SHELL_FLUSH_ACK, 1, { requestId: id, persisted: true });
    electronMock.emit(IPC_CHANNELS.SHELL_FLUSH_ACK, 2, { requestId: id, persisted: false });
    await expect(pending).resolves.toBe(false);
    expect(electronMock.listenerCount(IPC_CHANNELS.SHELL_FLUSH_ACK)).toBe(0);
  });

  it("returns false and removes the listener when a targeted window does not ack", async () => {
    electronMock.reset();
    addWindow(1);
    addWindow(2);

    const pending = flushRendererInstance("instance", 10);
    await Promise.resolve();
    const id = requestId(0);
    electronMock.emit(IPC_CHANNELS.SHELL_FLUSH_ACK, 1, { requestId: id, persisted: true });

    await expect(pending).resolves.toBe(false);
    expect(electronMock.listenerCount(IPC_CHANNELS.SHELL_FLUSH_ACK)).toBe(0);
  });

  it("resolves true immediately when no renderer window is alive", async () => {
    electronMock.reset();
    // The electron mock above returns an empty window list, so this exercises
    // the no-renderer fallback path used in headless environments and tests.
    // A missing renderer means "nothing pending" — a positive ack equivalent.
    const start = Date.now();
    const acked = await flushRendererInstance("any-id", 1000);
    expect(acked).toBe(true);
    expect(Date.now() - start).toBeLessThan(50);
  });
});
