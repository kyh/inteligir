import { describe, expect, it, vi } from "vitest";

// electron-updater is CJS with a default export holding autoUpdater.
vi.mock("electron-updater", () => ({
  default: {
    autoUpdater: {
      checkForUpdates: vi.fn(),
      on: vi.fn(),
    },
  },
}));

import { setupAutoUpdater } from "@/main/updater";

describe("setupAutoUpdater", () => {
  it("never contacts the feed in development", async () => {
    const updater = setupAutoUpdater({ isDevelopment: true });
    await updater.checkForUpdates();

    const electronUpdater = await import("electron-updater");
    expect(vi.mocked(electronUpdater.default.autoUpdater.checkForUpdates)).not.toHaveBeenCalled();
  });
});
