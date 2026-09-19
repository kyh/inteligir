// electron-updater makes the moves; this owns the policy. One step at a time,
// nothing downloads or installs without a click, a check shortly after launch
// and every few minutes after, and the server child stopped before Squirrel
// swaps the bundle under it. The state is a plain value the window mirrors.

import type { ProgressInfo, UpdateCheckResult, UpdateInfo } from "electron-updater";
import {
  initialUpdateState,
  reduceCheckFailure,
  reduceCheckStart,
  reduceDownloadComplete,
  reduceDownloadFailure,
  reduceDownloadProgress,
  reduceDownloadStart,
  reduceInstallFailure,
  reduceNoUpdate,
  reduceUpdateAvailable,
} from "../update-state";
import type { UpdateState } from "../update-state";
import { toErrorMessage } from "../types";

export const UPDATE_STARTUP_DELAY_MS = 15_000;
export const UPDATE_POLL_INTERVAL_MS = 4 * 60_000;

// the version is all the policy reads; the rest of electron-updater's info stays on its side
export type UpdateVersionInfo = Pick<UpdateInfo, "version">;

export interface UpdaterHandlers {
  readonly updateAvailable: (info: UpdateVersionInfo) => void;
  readonly updateNotAvailable: () => void;
  readonly downloadProgress: (progress: ProgressInfo) => void;
  readonly updateDownloaded: (info: UpdateVersionInfo) => void;
  readonly error: (error: Error) => void;
}

// the slice of electron-updater this policy drives, adapted in index.ts; a test hands in a fake
export interface UpdaterPort {
  // autoDownload and autoInstallOnAppQuit off: nothing moves without a click
  disarmAutomation: () => void;
  checkForUpdates: () => Promise<UpdateCheckResult | null>;
  downloadUpdate: () => Promise<string[]>;
  quitAndInstall: (isSilent: boolean, isForceRunAfter: boolean) => void;
  subscribe: (handlers: UpdaterHandlers) => void;
}

export interface UpdatesArgs {
  updater: UpdaterPort;
  currentVersion: string;
  // null when this build carries a feed and may check; otherwise the reason it never will
  disabledReason: string | null;
  // the shell's own child; an adopted server outlives the shell and is nobody's to stop
  stopServer: () => Promise<void>;
  broadcast: (state: UpdateState) => void;
  log: (message: string) => void;
  now?: () => string;
}

type InstallOutcome =
  | { kind: "quitting" }
  | { kind: "refused"; state: UpdateState }
  | { kind: "failed"; state: UpdateState };

export interface Updates {
  state: () => UpdateState;
  start: () => void;
  stop: () => void;
  check: (reason: string) => Promise<UpdateState>;
  download: () => Promise<UpdateState>;
  install: () => Promise<InstallOutcome>;
}

type Step = "check" | "download" | "install";

export const createUpdates = (args: UpdatesArgs): Updates => {
  const now = args.now ?? (() => new Date().toISOString());
  let state = initialUpdateState(args.currentVersion, args.disabledReason);
  let step: Step | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const setState = (next: UpdateState): void => {
    state = next;
    args.broadcast(state);
  };

  const reserve = (next: Step): boolean => {
    if (step !== null) {
      args.log(`${next} skipped: ${step} is in progress`);
      return false;
    }
    step = next;
    return true;
  };

  const release = (done: Step): void => {
    if (step === done) {
      step = null;
    }
  };

  args.updater.subscribe({
    downloadProgress(progress) {
      const next = reduceDownloadProgress(state, progress.percent);
      if (next.downloadPercent !== state.downloadPercent) {
        setState(next);
      }
    },
    // a step in flight reports its own rejection; this is the background case
    error(error) {
      const message = toErrorMessage(error);
      args.log(`updater error: ${message}`);
      if (step === null && state.status !== "disabled") {
        setState(reduceCheckFailure(state, message, now()));
      }
    },
    updateAvailable(info) {
      setState(reduceUpdateAvailable(state, info.version, now()));
      args.log(`update available: ${info.version}`);
    },
    updateDownloaded(info) {
      setState(reduceDownloadComplete(state, info.version));
      args.log(`update downloaded: ${info.version}`);
    },
    updateNotAvailable() {
      setState(reduceNoUpdate(state, now()));
    },
  });

  const check = async (reason: string): Promise<UpdateState> => {
    if (state.status === "disabled") {
      return state;
    }
    if (state.status === "downloading" || state.status === "downloaded") {
      args.log(`check (${reason}) skipped: an update is already ${state.status}`);
      return state;
    }
    if (!reserve("check")) {
      return state;
    }
    setState(reduceCheckStart(state, now()));
    args.log(`checking for updates (${reason})`);
    try {
      await args.updater.checkForUpdates();
    } catch (error) {
      setState(reduceCheckFailure(state, toErrorMessage(error), now()));
    } finally {
      release("check");
    }
    return state;
  };

  const download = async (): Promise<UpdateState> => {
    if (state.availableVersion === null || state.downloadedVersion !== null) {
      return state;
    }
    if (!reserve("download")) {
      return state;
    }
    setState(reduceDownloadStart(state));
    args.log(`downloading ${state.availableVersion}`);
    try {
      await args.updater.downloadUpdate();
    } catch (error) {
      setState(reduceDownloadFailure(state, toErrorMessage(error)));
    } finally {
      release("download");
    }
    return state;
  };

  const install = async (): Promise<InstallOutcome> => {
    if (state.downloadedVersion === null) {
      return { kind: "refused", state };
    }
    if (!reserve("install")) {
      return { kind: "refused", state };
    }
    args.log(`installing ${state.downloadedVersion}: stopping the server`);
    try {
      await args.stopServer();
      args.updater.quitAndInstall(true, true);
      return { kind: "quitting" };
    } catch (error) {
      setState(reduceInstallFailure(state, toErrorMessage(error)));
      release("install");
      return { kind: "failed", state };
    }
  };

  return {
    check,
    download,
    install,
    start() {
      if (state.status === "disabled") {
        args.log(`updates disabled: ${state.message ?? "no reason given"}`);
        return;
      }
      args.updater.disarmAutomation();
      startupTimer = setTimeout(() => {
        void check("startup");
      }, UPDATE_STARTUP_DELAY_MS);
      pollTimer = setInterval(() => {
        void check("poll");
      }, UPDATE_POLL_INTERVAL_MS);
    },
    state: () => state,
    stop() {
      if (startupTimer !== null) {
        clearTimeout(startupTimer);
      }
      if (pollTimer !== null) {
        clearInterval(pollTimer);
      }
      startupTimer = null;
      pollTimer = null;
    },
  };
};
