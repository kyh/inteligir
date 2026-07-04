// ---------------------------------------------------------------------------
// electron-updater wiring — the desktop-only overlay over the registry's
// UPDATE_METHODS trio. The host's handler map deliberately excludes these
// (a WS transport has nothing to self-update); the shell registers them on
// ipcMain directly and emits onUpdateState itself.
// ---------------------------------------------------------------------------

import { ipcMain } from "electron";
import electronUpdater from "electron-updater";

import { IPC } from "@repo/features/ipc-registry";
import { toErrorMessage, type UpdateState } from "@repo/features/ipc";

import { sendToAllWindows } from "./host-fold";

const { autoUpdater } = electronUpdater;

const STARTUP_UPDATE_DELAY_MS = 15_000;

export type UpdaterOptions = {
  /** Dev builds never contact the update feed. */
  isDevelopment: boolean;
  /** Awaited before quitAndInstall so the agent + executor daemon stop first. */
  gracefulShutdown: () => Promise<void>;
};

export type Updater = {
  checkForUpdates: () => Promise<void>;
};

export function setupAutoUpdater(options: UpdaterOptions): Updater {
  const { isDevelopment, gracefulShutdown } = options;

  let updateState: UpdateState = {
    status: "idle",
    version: null,
    downloadPercent: null,
    message: null,
  };

  function setUpdateState(patch: Partial<UpdateState>): void {
    updateState = { ...updateState, ...patch };
    sendToAllWindows(IPC.onUpdateState.channel, updateState);
  }

  async function checkForUpdates(): Promise<void> {
    if (isDevelopment) return;

    setUpdateState({ status: "checking", message: null, downloadPercent: null });

    try {
      await autoUpdater.checkForUpdates();
    } catch (error: unknown) {
      setUpdateState({ status: "error", message: toErrorMessage(error) });
    }
  }

  ipcMain.handle(IPC.checkForUpdates.channel, async () => {
    await checkForUpdates();
    return updateState;
  });

  ipcMain.handle(IPC.downloadUpdate.channel, async () => {
    if (updateState.status !== "available") {
      return { accepted: false, state: updateState };
    }
    try {
      setUpdateState({ status: "downloading", downloadPercent: 0 });
      await autoUpdater.downloadUpdate();
      return { accepted: true, state: updateState };
    } catch (error: unknown) {
      setUpdateState({ status: "error", message: toErrorMessage(error) });
      return { accepted: false, state: updateState };
    }
  });

  ipcMain.handle(IPC.installUpdate.channel, () => {
    if (updateState.status !== "downloaded") {
      return { accepted: false, state: updateState };
    }
    // Graceful shutdown FIRST: quitAndInstall's internal quit must not be
    // intercepted (preventDefault breaks the install on some platforms), and
    // the executor daemon must not outlive the app across an update.
    const shutdownThenInstall = async (): Promise<void> => {
      await gracefulShutdown();
      try {
        autoUpdater.quitAndInstall();
      } catch (error: unknown) {
        setUpdateState({ status: "error", message: toErrorMessage(error) });
      }
    };
    setImmediate(() => void shutdownThenInstall());
    return { accepted: true, state: updateState };
  });

  if (!isDevelopment) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on("update-available", (info) => {
      setUpdateState({ status: "available", version: info.version });
    });

    autoUpdater.on("update-not-available", () => {
      setUpdateState({ status: "not-available" });
    });

    autoUpdater.on("download-progress", (progress) => {
      setUpdateState({ status: "downloading", downloadPercent: Math.floor(progress.percent) });
    });

    autoUpdater.on("update-downloaded", (info) => {
      setUpdateState({ status: "downloaded", version: info.version, downloadPercent: 100 });
    });

    autoUpdater.on("error", (error) => {
      setUpdateState({ status: "error", message: error.message });
    });

    setTimeout(() => void checkForUpdates(), STARTUP_UPDATE_DELAY_MS);
  }

  return { checkForUpdates };
}
