import { describe, expect, it, vi } from "vitest";

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

import { setupAutoUpdater } from "@/main/updater";
import { UPDATE_METHODS } from "@repo/features/ipc-registry";

describe("setupAutoUpdater", () => {
  it("exposes exactly the registry's updater trio as shell handlers", () => {
    const updater = setupAutoUpdater({
      isDevelopment: true,
      gracefulShutdown: () => Promise.resolve(),
      broadcast: () => {},
    });

    expect(Object.keys(updater.handlers).toSorted()).toEqual([...UPDATE_METHODS].toSorted());
  });

  it("never contacts the feed in development", async () => {
    const updater = setupAutoUpdater({
      isDevelopment: true,
      gracefulShutdown: () => Promise.resolve(),
      broadcast: () => {},
    });
    await updater.checkForUpdates();

    const electronUpdater = await import("electron-updater");
    expect(vi.mocked(electronUpdater.default.autoUpdater.checkForUpdates)).not.toHaveBeenCalled();
  });

  it("pushes state through the injected broadcast", async () => {
    const broadcast = vi.fn();
    const updater = setupAutoUpdater({
      isDevelopment: false,
      gracefulShutdown: () => Promise.resolve(),
      broadcast,
    });

    await updater.handlers.checkForUpdates(undefined);

    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ status: "checking", message: null }),
    );
  });
});
