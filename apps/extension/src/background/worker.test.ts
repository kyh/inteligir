import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import worker from "../entrypoints/background";
import type { ExtensionRequest, WorkerAnswer } from "../messages";
import { readConnection } from "./connection";
import { keepSave, queuedSaves, SEND_ALARM } from "./save-queue";
import { CONNECTION, handOver, MINTED } from "./test-support/fake-cloud";

const WAITING = {
  deviceId: CONNECTION.deviceId,
  firstTry: false,
  id: "01900000-0000-7000-8000-000000000001",
  opId: "01900000-0000-7000-8000-0000000000a1",
  savedAt: Date.UTC(2026, 10, 5, 12),
  title: "File over app",
  url: "https://example.test/file-over-app",
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

// what the worker answers one of its own pages
const ask = async (request: ExtensionRequest): Promise<WorkerAnswer | undefined> => {
  const page = { id: browser.runtime.id, url: browser.runtime.getURL("/welcome.html") };
  const answers: WorkerAnswer[] = [];
  void fakeBrowser.runtime.onMessage.trigger(request, page, (answer: WorkerAnswer) => {
    answers.push(answer);
  });
  await vi.waitFor(() => {
    expect(answers).toHaveLength(1);
  });
  return answers[0];
};

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

  it("says where the connection can be let go, and Disconnect lets it go there", async () => {
    await handOver(MINTED);
    await keepSave(WAITING);
    const cloud = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", cloud);
    worker.main();
    await expect(ask({ type: "status" })).resolves.toMatchObject({
      connection: {
        email: CONNECTION.email,
        manageUrl: browser.runtime.getURL("/welcome.html"),
      },
    });
    await expect(ask({ type: "disconnect" })).resolves.toMatchObject({ connection: null });
    await expect(readConnection()).resolves.toBeNull();
    await expect(queuedSaves()).resolves.toStrictEqual([]);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeUndefined();
    // the revoke, which nothing waits on
    await vi.waitFor(() => {
      expect(cloud).toHaveBeenCalledOnce();
    });
  });
});
