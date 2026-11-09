// @vitest-environment jsdom

import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { desktopBridge } from "./desktop-bridge";
import type { DesktopBridge, DesktopUpdateState } from "./desktop-bridge";

afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});

// what the shell answers, its own shapes and one it never sends
type ShellAnswer = { readonly status: string; readonly version?: string } | null;

// Tauri's mock fakes the IPC alone, not the marker the runtime sets on every page it hosts, and
// that marker is all isTauri() reads
const underShell = (answer: (command: string) => ShellAnswer): DesktopBridge => {
  vi.stubGlobal("isTauri", true);
  mockIPC((command) => answer(command), { shouldMockEvents: true });
  const bridge = desktopBridge();
  if (bridge === null) {
    throw new Error("the bridge stayed shut under the shell");
  }
  return bridge;
};

describe("the Mac app's door", () => {
  it("is shut in a browser tab", () => {
    expect(desktopBridge()).toBeNull();
  });

  it("asks the shell's command and hands back the state it answered", async () => {
    const asked: string[] = [];
    const bridge = underShell((command) => {
      asked.push(command);
      return { status: "available", version: "1.2.3" };
    });
    await expect(bridge.checkForUpdates()).resolves.toStrictEqual({
      status: "available",
      version: "1.2.3",
    });
    await bridge.downloadUpdate();
    await bridge.installUpdate();
    expect(asked).toStrictEqual(["check_for_updates", "download_update", "install_update"]);
  });

  it("refuses an answer it does not know", async () => {
    const bridge = underShell(() => ({ status: "ready" }));
    await expect(bridge.checkForUpdates()).rejects.toBeInstanceOf(ZodError);
  });

  it("hands a listener every state the shell pushes, and drops a frame it does not know", async () => {
    const bridge = underShell(() => null);
    const heard: DesktopUpdateState[] = [];
    const stop = bridge.onUpdateState((state) => {
      heard.push(state);
    });
    await vi.waitFor(async () => {
      await emit("update-state", { downloadPercent: 40, status: "downloading" });
      expect(heard.length).toBeGreaterThan(0);
    });
    await emit("update-state", { status: "ready" });
    expect(heard.at(-1)).toStrictEqual({ downloadPercent: 40, status: "downloading" });
    expect(heard.every((state) => state.status === "downloading")).toBe(true);
    stop();
  });
});
