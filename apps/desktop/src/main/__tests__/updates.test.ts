import type { ProgressInfo, UpdateInfo } from "electron-updater";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createUpdates,
  UPDATE_POLL_INTERVAL_MS,
  UPDATE_STARTUP_DELAY_MS,
  type UpdaterHandlers,
  type UpdaterPort,
} from "../updates";
import type { UpdateState } from "../../update-state";

const noop = (): void => {};

function updateInfo(version: string): UpdateInfo {
  return { version, files: [], path: "", sha512: "", releaseDate: "" };
}

function progress(percent: number): ProgressInfo {
  return { percent, total: 100, delta: 0, transferred: percent, bytesPerSecond: 0 };
}

interface FakeUpdater extends UpdaterPort {
  calls: string[];
  checkResult: () => Promise<void>;
  downloadResult: () => Promise<void>;
  installThrows: Error | null;
  handlers: UpdaterHandlers;
}

function fakeUpdater(): FakeUpdater {
  const updater: FakeUpdater = {
    calls: [],
    checkResult: () => Promise.resolve(),
    downloadResult: () => Promise.resolve(),
    installThrows: null,
    handlers: {
      updateAvailable: noop,
      updateNotAvailable: noop,
      downloadProgress: noop,
      updateDownloaded: noop,
      error: noop,
    },
    disarmAutomation() {
      updater.calls.push("disarm");
    },
    async checkForUpdates() {
      updater.calls.push("check");
      await updater.checkResult();
      return null;
    },
    async downloadUpdate() {
      updater.calls.push("download");
      await updater.downloadResult();
      return [];
    },
    quitAndInstall(isSilent, isForceRunAfter) {
      updater.calls.push(`quitAndInstall(${String(isSilent)},${String(isForceRunAfter)})`);
      if (updater.installThrows !== null) throw updater.installThrows;
    },
    subscribe(handlers) {
      updater.handlers = handlers;
    },
  };
  return updater;
}

function harness(disabledReason: string | null = null) {
  const updater = fakeUpdater();
  const broadcasts: UpdateState[] = [];
  const log: string[] = [];
  const updates = createUpdates({
    updater,
    currentVersion: "0.4.0",
    disabledReason,
    stopServer: async () => {
      updater.calls.push("stopServer");
    },
    broadcast: (state) => broadcasts.push(state),
    log: (message) => log.push(message),
    now: () => "2026-09-04T10:00:00.000Z",
  });
  const findsVersion = (version: string): void => {
    updater.checkResult = () => {
      updater.handlers.updateAvailable(updateInfo(version));
      return Promise.resolve();
    };
  };
  const downloadsVersion = (version: string): void => {
    updater.downloadResult = () => {
      updater.handlers.updateDownloaded(updateInfo(version));
      return Promise.resolve();
    };
  };
  return { updater, updates, broadcasts, log, findsVersion, downloadsVersion };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the updater policy", () => {
  it("turns automatic download and install off, then checks after the startup delay and on the poll", async () => {
    const { updater, updates } = harness();
    updates.start();
    expect(updater.calls).toEqual(["disarm"]);
    await vi.advanceTimersByTimeAsync(UPDATE_STARTUP_DELAY_MS);
    expect(updater.calls).toEqual(["disarm", "check"]);
    await vi.advanceTimersByTimeAsync(UPDATE_POLL_INTERVAL_MS);
    expect(updater.calls).toEqual(["disarm", "check", "check"]);
    updates.stop();
    await vi.advanceTimersByTimeAsync(UPDATE_POLL_INTERVAL_MS * 3);
    expect(updater.calls).toEqual(["disarm", "check", "check"]);
  });

  it("disabled never arms a timer and answers every action with the same state", async () => {
    const { updater, updates } = harness("only in the packaged app");
    updates.start();
    await vi.advanceTimersByTimeAsync(UPDATE_STARTUP_DELAY_MS + UPDATE_POLL_INTERVAL_MS);
    expect(updater.calls).toEqual([]);
    expect((await updates.check("menu")).status).toBe("disabled");
    expect((await updates.download()).status).toBe("disabled");
    expect((await updates.install()).kind).toBe("refused");
  });

  it("a check lands available through the event and a rejection lands as an error", async () => {
    const { updater, updates, broadcasts, findsVersion } = harness();
    findsVersion("0.5.0");
    const state = await updates.check("menu");
    expect(state.status).toBe("available");
    expect(state.availableVersion).toBe("0.5.0");
    expect(broadcasts.map((b) => b.status)).toEqual(["checking", "available"]);

    updater.checkResult = () => Promise.reject(new Error("feed unreachable"));
    const failed = await updates.check("poll");
    expect(failed.status).toBe("error");
    expect(failed.message).toBe("feed unreachable");
    // the version already found is kept, so the next click retries the download
    expect(failed.availableVersion).toBe("0.5.0");
  });

  it("one step at a time: a check during a download is skipped, not queued", async () => {
    const { updater, updates, log, findsVersion } = harness();
    findsVersion("0.5.0");
    await updates.check("startup");
    let finishDownload: () => void = noop;
    updater.downloadResult = () =>
      new Promise<void>((resolve) => {
        finishDownload = resolve;
      });
    const downloading = updates.download();
    expect(updates.state().status).toBe("downloading");
    expect((await updates.check("poll")).status).toBe("downloading");
    updater.handlers.downloadProgress(progress(50.7));
    expect(updates.state().downloadPercent).toBe(50);
    updater.handlers.updateDownloaded(updateInfo("0.5.0"));
    finishDownload();
    expect((await downloading).status).toBe("downloaded");
    expect(updater.calls).toEqual(["check", "download"]);
    expect(log.some((line) => line.includes("skipped"))).toBe(true);
  });

  it("install stops the server first, then hands Squirrel a silent forced relaunch", async () => {
    const { updater, updates, findsVersion, downloadsVersion } = harness();
    expect((await updates.install()).kind).toBe("refused");
    findsVersion("0.5.0");
    await updates.check("menu");
    downloadsVersion("0.5.0");
    await updates.download();
    expect((await updates.install()).kind).toBe("quitting");
    expect(updater.calls.slice(-2)).toEqual(["stopServer", "quitAndInstall(true,true)"]);
  });

  it("an installer that throws reports failed with the reason and keeps the download", async () => {
    const { updater, updates, findsVersion, downloadsVersion } = harness();
    findsVersion("0.5.0");
    await updates.check("menu");
    downloadsVersion("0.5.0");
    await updates.download();
    updater.installThrows = new Error("no update downloaded");
    const outcome = await updates.install();
    expect(outcome.kind).toBe("failed");
    expect(outcome.kind === "failed" && outcome.state.message).toBe("no update downloaded");
    expect(updates.state().downloadedVersion).toBe("0.5.0");
  });

  it("a background error lands as an error only when no step owns it", async () => {
    const { updater, updates } = harness();
    updater.handlers.error(new Error("background"));
    expect(updates.state().status).toBe("error");
    let finishCheck: () => void = noop;
    updater.checkResult = () =>
      new Promise<void>((resolve) => {
        finishCheck = resolve;
      });
    const checking = updates.check("menu");
    updater.handlers.error(new Error("during the check"));
    expect(updates.state().status).toBe("checking");
    updater.handlers.updateNotAvailable();
    finishCheck();
    expect((await checking).status).toBe("up-to-date");
  });
});
