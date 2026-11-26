import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { desktopBridge } from "./shell/desktop-bridge";
import type { DesktopBridge, DesktopUpdateState } from "./shell/desktop-bridge";
import { createUpdatesStore } from "./desktop-updates";
import { underShell } from "./test-support/desktop-shell.test-utils";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const AVAILABLE: DesktopUpdateState = { status: "available", version: "1.2.3" };

type Ask = () => Promise<DesktopUpdateState | null>;

const fakeBridge = (check: Ask) => {
  const pushes: ((state: DesktopUpdateState) => void)[] = [];

  const bridge = {
    checkForUpdates: vi.fn<Ask>(check),
    downloadUpdate: vi.fn<Ask>(async () => ({ downloadPercent: 0, status: "downloading" })),
    installUpdate: vi.fn<Ask>(async () => AVAILABLE),
    onUpdateState: (listener: (state: DesktopUpdateState) => void) => {
      pushes.push(listener);

      return () => {};
    },
  } satisfies DesktopBridge;

  const push = (state: DesktopUpdateState) => {
    for (const listener of pushes) {
      listener(state);
    }
  };

  return { bridge, push };
};

describe("the updates store", () => {
  it("holds nothing in a browser tab", () => {
    const { result } = renderHook(createUpdatesStore(null).use);
    expect(result.current).toBeNull();
  });

  it("checks once as its first screen subscribes, and adopts the answer", async () => {
    const { bridge } = fakeBridge(async () => AVAILABLE);
    const store = createUpdatesStore(bridge);
    expect(bridge.checkForUpdates).not.toHaveBeenCalled();
    const first = renderHook(store.use);
    renderHook(store.use);
    await vi.waitFor(() => {
      expect(first.result.current).toStrictEqual(AVAILABLE);
    });
    expect(bridge.checkForUpdates).toHaveBeenCalledOnce();
  });

  it("adopts what the shell pushes, and what a move answers", async () => {
    const { bridge, push } = fakeBridge(async () => AVAILABLE);
    const store = createUpdatesStore(bridge);
    const { result } = renderHook(store.use);
    act(() => {
      push({ downloadPercent: 40, status: "downloading" });
    });
    expect(result.current).toStrictEqual({ downloadPercent: 40, status: "downloading" });
    await act(async () => {
      await store.move("download");
    });
    expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
    expect(result.current).toStrictEqual({ downloadPercent: 0, status: "downloading" });
  });

  it("keeps the last state when a command's answer can't be read", async () => {
    const { bridge } = fakeBridge(async () => null);
    bridge.downloadUpdate.mockResolvedValueOnce(null);
    const store = createUpdatesStore(bridge);
    const { result } = renderHook(store.use);
    expect(bridge.checkForUpdates).toHaveBeenCalledOnce();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toStrictEqual({ status: "idle" });
    bridge.checkForUpdates.mockResolvedValueOnce(AVAILABLE);
    await act(async () => {
      await store.move("check");
    });
    await act(async () => {
      await store.move("download");
    });
    expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
    expect(result.current).toStrictEqual(AVAILABLE);
  });

  it("treats an answer it can't read alike from the shell's commands and its event", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const answers = new Map<string, unknown>([["check-for-updates", AVAILABLE]]);

    const shell = underShell((command) => {
      if (command === "install-update") {
        throw new Error("not allowed");
      }

      return answers.get(command) ?? { status: "ready" };
    });

    const store = createUpdatesStore(desktopBridge());
    const { result } = renderHook(store.use);
    await vi.waitFor(() => {
      expect(result.current).toStrictEqual(AVAILABLE);
    });

    await act(async () => {
      await store.move("download");
    });
    expect(result.current).toStrictEqual(AVAILABLE);
    await act(async () => {
      await store.move("install");
    });
    expect(result.current).toStrictEqual(AVAILABLE);
    await act(async () => {
      shell.push("update-state", { status: "ready" });
    });
    expect(result.current).toStrictEqual(AVAILABLE);
    expect(warned).toHaveBeenCalledTimes(3);
  });
});
