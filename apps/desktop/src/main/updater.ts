import electronUpdater from "electron-updater";

import type { UpdateState } from "../shared/bridge";
import { apply, percentOf, wire } from "./update-session";
import type { Phase, UpdateEvent } from "./update-session";

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * The update flow the page drives, one phase moved by one pure step (`update-session.ts`). Nothing
 * moves without the person: the page checks when it loads, and the download and the restart each
 * wait for a click.
 */
export const createUpdater = (
  enabled: boolean,
  announce: (state: UpdateState) => void,
  beforeInstall: () => void,
) => {
  const { autoUpdater } = electronUpdater;
  let phase: Phase = { kind: "idle" };

  const step = (event: UpdateEvent) => {
    const before = wire(phase);
    const next = apply(phase, event);
    ({ phase } = next);
    const after = wire(phase);

    if (JSON.stringify(after) !== JSON.stringify(before)) {
      announce(after);
    }

    return { state: after, work: next.work };
  };

  if (enabled) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on("download-progress", (progress) => {
      step({ kind: "progress", percent: percentOf(progress.percent) });
    });
    autoUpdater.on("error", (error) => {
      step({ kind: "install-failed", message: error.message });
    });
  }

  const check = async () => {
    if (!enabled) {
      return { status: "idle" } satisfies UpdateState;
    }

    const { state, work } = step({ kind: "check-asked" });

    if (work !== "check") {
      return state;
    }

    try {
      const result = await autoUpdater.checkForUpdates();
      const found = result?.isUpdateAvailable === true ? result.updateInfo.version : null;

      return step({ found, kind: "checked" }).state;
    } catch (error: unknown) {
      return step({ kind: "check-ended-badly", message: messageOf(error) }).state;
    }
  };

  const download = async () => {
    const { state, work } = step({ kind: "download-asked" });

    if (work !== "download") {
      return state;
    }

    try {
      await autoUpdater.downloadUpdate();

      return step({ kind: "download-ended", message: null }).state;
    } catch (error: unknown) {
      return step({ kind: "download-ended", message: messageOf(error) }).state;
    }
  };

  const install = () => {
    const { state, work } = step({ kind: "install-asked" });

    if (work === "install") {
      setImmediate(() => {
        beforeInstall();

        try {
          autoUpdater.quitAndInstall();
        } catch (error: unknown) {
          step({ kind: "install-failed", message: messageOf(error) });
        }
      });
    }

    return state;
  };

  return { check, download, install };
};
