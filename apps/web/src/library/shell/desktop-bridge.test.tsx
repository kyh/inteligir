import { afterEach, describe, expect, it, vi } from "vitest";

import { desktopBridge } from "./desktop-bridge";
import type { DesktopUpdateState } from "./desktop-bridge";
import { underShell as standIn } from "../test-support/desktop-shell.test-utils";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type ShellAnswer = {
  readonly message?: string;
  readonly status: string;
  readonly version?: string;
} | null;

const silenced = () => vi.spyOn(console, "warn").mockImplementation(() => {});

let push: ReturnType<typeof standIn>["push"] = () => {};

const underShell = (answer: (command: string) => ShellAnswer) => {
  ({ push } = standIn(answer));
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
    expect(asked).toStrictEqual(["check-for-updates", "download-update", "install-update"]);
  });

  it("tells a check that failed from a download and an install that did", async () => {
    const bridge = underShell((command) =>
      command === "check-for-updates"
        ? { message: "offline", status: "check-failed" }
        : {
            message: "offline",
            status: command === "download-update" ? "download-failed" : "install-failed",
            version: "1.2.3",
          },
    );

    await expect(bridge.checkForUpdates()).resolves.toStrictEqual({
      message: "offline",
      status: "check-failed",
    });
    await expect(bridge.downloadUpdate()).resolves.toStrictEqual({
      message: "offline",
      status: "download-failed",
      version: "1.2.3",
    });
    await expect(bridge.installUpdate()).resolves.toStrictEqual({
      message: "offline",
      status: "install-failed",
      version: "1.2.3",
    });
  });

  it("answers none, and says so, for an answer it does not know or a command the shell refused", async () => {
    const warned = silenced();

    const bridge = underShell((command) => {
      if (command === "install-update") {
        throw new Error("not allowed");
      }

      return { status: "ready" };
    });

    await expect(bridge.checkForUpdates()).resolves.toBeNull();
    await expect(bridge.installUpdate()).resolves.toBeNull();
    expect(warned).toHaveBeenCalledTimes(2);
  });

  it("hands a listener every state the shell pushes, and drops a frame it does not know", async () => {
    const warned = silenced();
    const bridge = underShell(() => null);
    const heard: DesktopUpdateState[] = [];

    const stop = bridge.onUpdateState((state) => {
      heard.push(state);
    });

    await vi.waitFor(async () => {
      push("update-state", { downloadPercent: 40, status: "downloading" });
      expect(heard.length).toBeGreaterThan(0);
    });
    push("update-state", { status: "ready" });
    expect(heard.at(-1)).toStrictEqual({ downloadPercent: 40, status: "downloading" });
    expect(heard.every((state) => state.status === "downloading")).toBe(true);
    expect(warned).toHaveBeenCalledOnce();
    stop();
  });

  it("hands on what quick capture copied, and drops a capture it can't read", () => {
    const bridge = underShell(() => null);
    const warned = silenced();
    const heard: string[] = [];

    const stop = bridge.onQuickCapture(({ clipboard }) => {
      heard.push(clipboard);
    });

    push("quick-capture", { clipboard: "https://example.com" });
    push("quick-capture", { copied: 3 });
    stop();

    push("quick-capture", { clipboard: "after it stopped" });
    expect(heard).toStrictEqual(["https://example.com"]);
    expect(warned).toHaveBeenCalledOnce();
  });

  it("hears no quick capture from a shell older than it", () => {
    vi.stubGlobal("desktopBridge", {
      checkForUpdates: async () => await Promise.resolve(null),
      downloadUpdate: async () => await Promise.resolve(null),
      installUpdate: async () => await Promise.resolve(null),
      onUpdateState: () => () => {},
    });
    const bridge = desktopBridge();
    expect(bridge?.onQuickCapture(() => {})).toBeTypeOf("function");
  });
});
