import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import worker from "../entrypoints/background";
import { keepSave, SEND_ALARM } from "./save-queue";
import { CONNECTION, handOver, MINTED } from "./test-support/fake-cloud";

const WAITING = {
  deviceId: CONNECTION.deviceId,
  id: "01900000-0000-7000-8000-000000000001",
  opId: "01900000-0000-7000-8000-0000000000a1",
  savedAt: Date.UTC(2026, 10, 5, 12),
  selection: null,
  title: "File over app",
  url: "https://example.test/file-over-app",
  waitingSince: Date.UTC(2026, 10, 5, 12),
};

// the calls the fake browser leaves out, which the worker makes
beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(browser.runtime, "getManifest").mockReturnValue({
    manifest_version: 3,
    name: "Inteligir",
    version: "0.6.0",
  });
  vi.spyOn(browser.runtime.onMessageExternal, "addListener").mockImplementation(() => {});
  vi.spyOn(browser.contextMenus.onClicked, "addListener").mockImplementation(() => {});
  vi.spyOn(browser.storage.local, "setAccessLevel").mockResolvedValue();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the worker", () => {
  it("sends what waited as the browser starts, and holds the alarm a restart may have cleared", async () => {
    await handOver(MINTED);
    await keepSave(WAITING);
    await browser.alarms.clearAll();
    const cloud = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", cloud);
    worker.main();
    await fakeBrowser.runtime.onStartup.trigger();
    await vi.waitFor(() => {
      expect(cloud).toHaveBeenCalledOnce();
    });
    await vi.waitFor(async () => {
      await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeDefined();
    });
  });
});
