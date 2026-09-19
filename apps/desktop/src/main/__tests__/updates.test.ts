import type { ProgressInfo } from "electron-updater";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUpdates, UPDATE_POLL_INTERVAL_MS, UPDATE_STARTUP_DELAY_MS } from "../updates";
import type { UpdaterHandlers, UpdaterPort, UpdateVersionInfo } from "../updates";
import type { UpdateState } from "../../update-state";

const noop = (): void => {};

const updateInfo = (version: string): UpdateVersionInfo => ({ version });

// a step held open until the test releases it
interface Deferred {
  promise: Promise<void>;
  release: () => void;
}

const deferred = (): Deferred => {
  let release: () => void = noop;
  // oxlint-disable-next-line promise/avoid-new -- no callback API to wrap: the test itself is the resolver
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

const progress = (percent: number): ProgressInfo => ({
  bytesPerSecond: 0,
  delta: 0,
  percent,
  total: 100,
  transferred: percent,
});

interface FakeUpdater extends UpdaterPort {
  calls: string[];
  checkResult: () => void | Promise<void>;
  downloadResult: () => void | Promise<void>;
  installThrows: Error | null;
  handlers: UpdaterHandlers;
}

const fakeUpdater = (): FakeUpdater => {
  const updater: FakeUpdater = {
    calls: [],
    async checkForUpdates() {
      updater.calls.push("check");
      await updater.checkResult();
      return null;
    },
    checkResult: noop,
    disarmAutomation() {
      updater.calls.push("disarm");
    },
    downloadResult: noop,
    async downloadUpdate() {
      updater.calls.push("download");
      await updater.downloadResult();
      return [];
    },
    handlers: {
      downloadProgress: noop,
      error: noop,
      updateAvailable: noop,
      updateDownloaded: noop,
      updateNotAvailable: noop,
    },
    installThrows: null,
    quitAndInstall(isSilent, isForceRunAfter) {
      updater.calls.push(`quitAndInstall(${String(isSilent)},${String(isForceRunAfter)})`);
      if (updater.installThrows !== null) {
        throw updater.installThrows;
      }
    },
    subscribe(handlers) {
      updater.handlers = handlers;
    },
  };
  return updater;
};

const harness = (disabledReason: string | null = null) => {
  const updater = fakeUpdater();
  const broadcasts: UpdateState[] = [];
  const log: string[] = [];
  const updates = createUpdates({
    broadcast: (state) => {
      broadcasts.push(state);
    },
    currentVersion: "0.4.0",
    disabledReason,
    log: (message) => {
      log.push(message);
    },
    now: () => "2026-09-04T10:00:00.000Z",
    stopServer: async () => {
      updater.calls.push("stopServer");
      await Promise.resolve();
    },
    updater,
  });
  const findsVersion = (version: string): void => {
    updater.checkResult = () => {
      updater.handlers.updateAvailable(updateInfo(version));
    };
  };
  const downloadsVersion = (version: string): void => {
    updater.downloadResult = () => {
      updater.handlers.updateDownloaded(updateInfo(version));
    };
  };
  return { broadcasts, downloadsVersion, findsVersion, log, updater, updates };
};

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
    const checked = await updates.check("menu");
    expect(checked.status).toBe("disabled");
    const downloaded = await updates.download();
    expect(downloaded.status).toBe("disabled");
    const installed = await updates.install();
    expect(installed.kind).toBe("refused");
  });

  it("a check lands available through the event and a rejection lands as an error", async () => {
    const { updater, updates, broadcasts, findsVersion } = harness();
    findsVersion("0.5.0");
    const state = await updates.check("menu");
    expect(state.status).toBe("available");
    expect(state.availableVersion).toBe("0.5.0");
    expect(broadcasts.map((b) => b.status)).toEqual(["checking", "available"]);

    updater.checkResult = () => {
      throw new Error("feed unreachable");
    };
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
    const download = deferred();
    updater.downloadResult = async () => {
      await download.promise;
    };
    const downloading = updates.download();
    expect(updates.state().status).toBe("downloading");
    const checked = await updates.check("poll");
    expect(checked.status).toBe("downloading");
    updater.handlers.downloadProgress(progress(50.7));
    expect(updates.state().downloadPercent).toBe(50);
    updater.handlers.updateDownloaded(updateInfo("0.5.0"));
    download.release();
    const downloaded = await downloading;
    expect(downloaded.status).toBe("downloaded");
    expect(updater.calls).toEqual(["check", "download"]);
    expect(log.some((line) => line.includes("skipped"))).toBe(true);
  });

  it("install stops the server first, then hands Squirrel a silent forced relaunch", async () => {
    const { updater, updates, findsVersion, downloadsVersion } = harness();
    const refused = await updates.install();
    expect(refused.kind).toBe("refused");
    findsVersion("0.5.0");
    await updates.check("menu");
    downloadsVersion("0.5.0");
    await updates.download();
    const installed = await updates.install();
    expect(installed.kind).toBe("quitting");
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
    const check = deferred();
    updater.checkResult = async () => {
      await check.promise;
    };
    const checking = updates.check("menu");
    updater.handlers.error(new Error("during the check"));
    expect(updates.state().status).toBe("checking");
    updater.handlers.updateNotAvailable();
    check.release();
    const checked = await checking;
    expect(checked.status).toBe("up-to-date");
  });
});
