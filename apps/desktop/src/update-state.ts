// The updater's one state, reduced in main and parsed off the bridge by the
// page: a plain value, so the renderer never holds electron-updater's objects
// and a frame from a main this page does not know fails at the parse.

import { z } from "zod";

const UPDATE_STATUSES = [
  "disabled",
  "idle",
  "checking",
  "up-to-date",
  "available",
  "downloading",
  "downloaded",
  "error",
] as const;

export const updateStateSchema = z.object({
  availableVersion: z.string().nullable(),
  checkedAt: z.string().nullable(),
  currentVersion: z.string().min(1),
  downloadPercent: z.number().min(0).max(100).nullable(),
  downloadedVersion: z.string().nullable(),
  // why nothing will be checked, or what the last step said when it failed
  message: z.string().nullable(),
  status: z.enum(UPDATE_STATUSES),
});

export type UpdateState = z.infer<typeof updateStateSchema>;

export type UpdateAction = "check" | "download" | "install";

export const initialUpdateState = (
  currentVersion: string,
  disabledReason: string | null,
): UpdateState => ({
  availableVersion: null,
  checkedAt: null,
  currentVersion,
  downloadPercent: null,
  downloadedVersion: null,
  message: disabledReason,
  status: disabledReason === null ? "idle" : "disabled",
});

// a downloaded update is already the answer, so a check keeps it
export const reduceCheckStart = (state: UpdateState, checkedAt: string): UpdateState => {
  const keepsDownload = state.downloadedVersion !== null;
  return {
    ...state,
    checkedAt,
    downloadPercent: keepsDownload ? 100 : null,
    message: null,
    status: "checking",
  };
};

export const reduceUpdateAvailable = (
  state: UpdateState,
  version: string,
  checkedAt: string,
): UpdateState => {
  if (state.downloadedVersion === version) {
    return { ...state, checkedAt, message: null, status: "downloaded" };
  }
  return {
    ...state,
    availableVersion: version,
    checkedAt,
    downloadPercent: null,
    downloadedVersion: null,
    message: null,
    status: "available",
  };
};

export const reduceNoUpdate = (state: UpdateState, checkedAt: string): UpdateState => {
  if (state.downloadedVersion !== null) {
    return { ...state, checkedAt, message: null, status: "downloaded" };
  }
  return {
    ...state,
    availableVersion: null,
    checkedAt,
    downloadPercent: null,
    message: null,
    status: "up-to-date",
  };
};

export const reduceCheckFailure = (
  state: UpdateState,
  message: string,
  checkedAt: string,
): UpdateState => ({ ...state, checkedAt, message, status: "error" });

export const reduceDownloadStart = (state: UpdateState): UpdateState => ({
  ...state,
  downloadPercent: 0,
  message: null,
  status: "downloading",
});

export const reduceDownloadProgress = (state: UpdateState, percent: number): UpdateState => ({
  ...state,
  downloadPercent: Math.min(100, Math.max(0, Math.floor(percent))),
  status: "downloading",
});

export const reduceDownloadComplete = (state: UpdateState, version: string): UpdateState => ({
  ...state,
  availableVersion: version,
  downloadPercent: 100,
  downloadedVersion: version,
  message: null,
  status: "downloaded",
});

// the version is still known, so the failure is retryable as a download, not a check
export const reduceDownloadFailure = (state: UpdateState, message: string): UpdateState => ({
  ...state,
  downloadPercent: null,
  message,
  status: "error",
});

export const reduceInstallFailure = (state: UpdateState, message: string): UpdateState => ({
  ...state,
  message,
  status: "error",
});

// what one button does next; null while a step is running or nothing can be done
export const updateAction = (state: UpdateState): UpdateAction | null => {
  switch (state.status) {
    case "disabled":
    case "checking":
    case "downloading": {
      return null;
    }
    case "idle":
    case "up-to-date": {
      return "check";
    }
    case "available": {
      return "download";
    }
    case "downloaded": {
      return "install";
    }
    case "error": {
      if (state.downloadedVersion !== null) {
        return "install";
      }
      if (state.availableVersion !== null) {
        return "download";
      }
      return "check";
    }
    default: {
      const exhaustive: never = state.status;
      return exhaustive;
    }
  }
};
