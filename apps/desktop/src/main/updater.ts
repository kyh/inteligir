// ---------------------------------------------------------------------------
// electron-updater wiring — desktop-shell-only, no Bridge surface. The app
// checks the update feed on a startup delay and from the "Check for
// Updates..." menu item; downloads stay off (autoDownload=false) until a UI
// consumes update state.
// ---------------------------------------------------------------------------

import electronUpdater from "electron-updater";

import { toErrorMessage } from "@repo/features/wire-helpers";

const { autoUpdater } = electronUpdater;

const STARTUP_UPDATE_DELAY_MS = 15_000;

export type UpdaterOptions = {
  /** Dev builds never contact the update feed. */
  isDevelopment: boolean;
};

export type Updater = {
  checkForUpdates: () => Promise<void>;
};

export function setupAutoUpdater(options: UpdaterOptions): Updater {
  const { isDevelopment } = options;

  async function checkForUpdates(): Promise<void> {
    if (isDevelopment) return;

    try {
      await autoUpdater.checkForUpdates();
    } catch (error: unknown) {
      console.error("[desktop] update check failed:", toErrorMessage(error));
    }
  }

  if (!isDevelopment) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    // autoUpdater is an EventEmitter — an unhandled "error" event (flaky
    // network mid-check) would crash the main process, so it stays handled.
    autoUpdater.on("error", (error) => {
      console.error("[desktop] auto-update error:", error.message);
    });

    setTimeout(() => void checkForUpdates(), STARTUP_UPDATE_DELAY_MS);
  }

  return { checkForUpdates };
}
