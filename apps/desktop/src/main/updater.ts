// ---------------------------------------------------------------------------
// electron-updater wiring — desktop-shell-only, no Bridge surface. The app
// checks the feed on a startup delay and from the "Check for Updates..." menu
// item, downloads what it finds, and offers a restart once the bytes are on
// disk. Declining is not a dead end: `autoInstallOnAppQuit` applies it the
// next time the app closes, so an update never depends on the user returning
// to a dialog they dismissed.
//
// A dialog rather than a Bridge channel: the startup check can beat the window
// into existence, and an update is a shell concern rather than a vault one.
// Staying off the Bridge also keeps it off the surface a paired phone reaches.
// ---------------------------------------------------------------------------

import { dialog } from "electron";
import electronUpdater from "electron-updater";

import { toErrorMessage } from "@repo/bridge/wire-helpers";

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
  // Only a check the user ASKED for reports "up to date" or an error. The
  // startup check stays silent on both, or every launch without a release
  // interrupts to say nothing happened.
  let userInitiated = false;
  // Guards against a second check while one is in flight — that would report
  // twice. Covers the download too, since one check drives both.
  let checking = false;

  function settle(): void {
    checking = false;
    userInitiated = false;
  }

  function report(type: "info" | "warning", message: string, detail?: string): void {
    if (!userInitiated) return;
    void dialog.showMessageBox(
      detail === undefined
        ? { type, message, buttons: ["OK"] }
        : { type, message, detail, buttons: ["OK"] },
    );
  }

  async function check(): Promise<void> {
    if (isDevelopment || checking) return;
    checking = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error: unknown) {
      const message = toErrorMessage(error);
      console.error("[desktop] update check failed:", message);
      report("warning", "Couldn't check for updates.", message);
      settle();
    }
  }

  if (!isDevelopment) {
    // Fetch as soon as one is found: a user who asked, or who is about to be
    // offered a restart, should not wait on a second round trip.
    autoUpdater.autoDownload = true;
    // The fallback for declining the restart below, so a dismissed dialog
    // still lands the update rather than losing it.
    autoUpdater.autoInstallOnAppQuit = true;

    // autoUpdater is an EventEmitter — an unhandled "error" event (flaky
    // network mid-check) would crash the main process, so it stays handled.
    autoUpdater.on("error", (error) => {
      console.error("[desktop] auto-update error:", error.message);
      report("warning", "Couldn't install the update.", error.message);
      settle();
    });

    autoUpdater.on("update-not-available", () => {
      report("info", "inteligir is up to date.");
      settle();
    });

    autoUpdater.on("update-downloaded", (info) => {
      settle();
      void dialog
        .showMessageBox({
          type: "info",
          message: `Version ${info.version} is ready.`,
          detail: "Restart now to use it, or it will be applied the next time you quit.",
          buttons: ["Restart now", "Later"],
          defaultId: 0,
          cancelId: 1,
        })
        .then((result) => {
          // Replaces the running app — nothing after this runs.
          if (result.response === 0) autoUpdater.quitAndInstall();
          return undefined;
        });
    });

    setTimeout(() => void check(), STARTUP_UPDATE_DELAY_MS);
  }

  return {
    checkForUpdates: async () => {
      userInitiated = true;
      await check();
    },
  };
}
