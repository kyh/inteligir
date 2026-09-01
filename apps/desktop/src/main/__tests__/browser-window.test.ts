// The browser session is prepared ONCE per launch: `session.fromPartition`
// answers the same process-lifetime Session on every call and `.on` appends,
// so a per-window setup makes one download attempt fire a warning — and a
// preventDefault — per reopen. The window is re-created on every close and
// reopen; the session never is.

import { afterEach, describe, expect, it, vi } from "vitest";

import { BROWSER_IPC } from "../browser-ipc";
import type { LiveServer } from "../server-instance";
import { showBrowserWindow } from "../browser-window";

type Listener = (...args: unknown[]) => void;

const fake = vi.hoisted(() => {
  class ListenerMap {
    private readonly listeners = new Map<string, Listener[]>();
    on(event: string, listener: Listener): this {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(listener);
      this.listeners.set(event, bucket);
      return this;
    }
    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
    }
    listenerCount(event: string): number {
      return this.listeners.get(event)?.length ?? 0;
    }
  }

  class FakeWebContents extends ListenerMap {
    navigationHistory = {
      canGoBack: (): boolean => false,
      canGoForward: (): boolean => false,
      goBack: (): void => {},
      goForward: (): void => {},
    };
    setWindowOpenHandler(): void {}
    loadFile(): Promise<void> {
      return Promise.resolve();
    }
    loadURL(): Promise<void> {
      return Promise.resolve();
    }
    getURL(): string {
      return "";
    }
    getTitle(): string {
      return "";
    }
    isLoading(): boolean {
      return false;
    }
    reload(): void {}
    send(): void {}
  }

  class FakeWebContentsView {
    webContents = new FakeWebContents();
    setBounds(): void {}
  }

  const windows: FakeBaseWindow[] = [];

  class FakeBaseWindow extends ListenerMap {
    contentView = { addChildView: (): void => {} };
    constructor() {
      super();
      windows.push(this);
    }
    getContentBounds() {
      return { x: 0, y: 0, width: 1100, height: 760 };
    }
    isMinimized(): boolean {
      return false;
    }
    restore(): void {}
    show(): void {}
    focus(): void {}
  }

  const browserSession = Object.assign(new ListenerMap(), {
    setPermissionRequestHandler: (): void => {},
    setPermissionCheckHandler: (): void => {},
    setDevicePermissionHandler: (): void => {},
  });

  const handled: string[] = [];

  return {
    browserSession,
    handled,
    windows,
    module: {
      BaseWindow: FakeBaseWindow,
      WebContentsView: FakeWebContentsView,
      app: { getAppPath: (): string => "/fake-app" },
      ipcMain: {
        handle: (channel: string): void => {
          handled.push(channel);
        },
      },
      nativeTheme: { shouldUseDarkColors: false },
      session: { fromPartition: (): typeof browserSession => browserSession },
    },
  };
});

// oxlint-disable-next-line anti-slop/no-module-mocking -- electron exists only inside the Electron runtime: there is no instance to inject under vitest, so the module seam is the only seam
vi.mock("electron", () => fake.module);

const server: LiveServer = { origin: "http://127.0.0.1:1", token: "test-token" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the browser window over one prepared session", () => {
  it("five open/close cycles leave one download guard and one IPC registration", () => {
    const warnings: unknown[][] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });

    for (let cycle = 0; cycle < 5; cycle += 1) {
      showBrowserWindow(server);
      fake.windows.at(-1)?.emit("closed");
    }

    // Each reopen after a close is a NEW window over the SAME session.
    expect(fake.windows).toHaveLength(5);
    expect(fake.browserSession.listenerCount("will-download")).toBe(1);

    let prevented = 0;
    fake.browserSession.emit(
      "will-download",
      {
        preventDefault: (): void => {
          prevented += 1;
        },
      },
      { getURL: (): string => "https://example.com/payload.zip" },
    );
    expect(prevented).toBe(1);
    expect(warnings).toHaveLength(1);

    // The IPC verbs registered once each, not once per window. STATE is
    // absent by design: it is a main→chrome send, never an invoke handler.
    expect(fake.handled).toEqual([...new Set(fake.handled)]);
    expect(fake.handled.length).toBeGreaterThan(0);
    for (const channel of fake.handled) {
      expect(Object.values(BROWSER_IPC)).toContain(channel);
    }
  });
});
