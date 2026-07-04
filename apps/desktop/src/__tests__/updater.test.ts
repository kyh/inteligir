import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

// electron-updater is CJS with a default export holding autoUpdater.
vi.mock("electron-updater", () => ({
  default: {
    autoUpdater: {
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
      on: vi.fn(),
    },
  },
}));

import { ipcMain } from "electron";

import { setupAutoUpdater } from "@/main/updater";
import { IPC, UPDATE_METHODS } from "@repo/features/ipc-registry";

const mockHandle = vi.mocked(ipcMain.handle);

beforeEach(() => {
  mockHandle.mockClear();
});

describe("setupAutoUpdater", () => {
  it("overlays exactly the registry's updater trio", () => {
    setupAutoUpdater({ isDevelopment: true, gracefulShutdown: () => Promise.resolve() });

    const expected = UPDATE_METHODS.map((m) => IPC[m].channel).toSorted();
    expect(mockHandle.mock.calls.map(([channel]) => channel).toSorted()).toEqual(expected);
  });

  it("never contacts the feed in development", async () => {
    const updater = setupAutoUpdater({
      isDevelopment: true,
      gracefulShutdown: () => Promise.resolve(),
    });
    await updater.checkForUpdates();

    const electronUpdater = await import("electron-updater");
    expect(vi.mocked(electronUpdater.default.autoUpdater.checkForUpdates)).not.toHaveBeenCalled();
  });
});
