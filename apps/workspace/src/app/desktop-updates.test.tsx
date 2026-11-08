// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopBridge, DesktopUpdateState } from "../shell/desktop-bridge";
import { createUpdatesStore } from "./desktop-updates";

afterEach(cleanup);

const AVAILABLE: DesktopUpdateState = { status: "available", version: "1.2.3" };

type Ask = () => Promise<DesktopUpdateState>;

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
  const push = (state: DesktopUpdateState): void => {
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

  it("says the update didn't go through when the shell refuses the call", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { bridge } = fakeBridge(async () => await Promise.reject(new Error("not allowed")));
    const { result } = renderHook(createUpdatesStore(bridge).use);
    await vi.waitFor(() => {
      expect(result.current).toStrictEqual({
        message: "The updater did not answer.",
        status: "error",
      });
    });
    expect(warned).toHaveBeenCalledOnce();
  });
});
