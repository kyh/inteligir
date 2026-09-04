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
  status: z.enum(UPDATE_STATUSES),
  currentVersion: z.string().min(1),
  availableVersion: z.string().nullable(),
  downloadedVersion: z.string().nullable(),
  downloadPercent: z.number().min(0).max(100).nullable(),
  // why nothing will be checked, or what the last step said when it failed
  message: z.string().nullable(),
  checkedAt: z.string().nullable(),
});

export type UpdateState = z.infer<typeof updateStateSchema>;

export type UpdateAction = "check" | "download" | "install";

export function initialUpdateState(
  currentVersion: string,
  disabledReason: string | null,
): UpdateState {
  return {
    status: disabledReason === null ? "idle" : "disabled",
    currentVersion,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    message: disabledReason,
    checkedAt: null,
  };
}

// a downloaded update is already the answer, so a check keeps it
export function reduceCheckStart(state: UpdateState, checkedAt: string): UpdateState {
  const keepsDownload = state.downloadedVersion !== null;
  return {
    ...state,
    status: "checking",
    checkedAt,
    message: null,
    downloadPercent: keepsDownload ? 100 : null,
  };
}

export function reduceUpdateAvailable(
  state: UpdateState,
  version: string,
  checkedAt: string,
): UpdateState {
  if (state.downloadedVersion === version) {
    return { ...state, status: "downloaded", checkedAt, message: null };
  }
  return {
    ...state,
    status: "available",
    availableVersion: version,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt,
    message: null,
  };
}

export function reduceNoUpdate(state: UpdateState, checkedAt: string): UpdateState {
  if (state.downloadedVersion !== null) {
    return { ...state, status: "downloaded", checkedAt, message: null };
  }
  return {
    ...state,
    status: "up-to-date",
    availableVersion: null,
    downloadPercent: null,
    checkedAt,
    message: null,
  };
}

export function reduceCheckFailure(
  state: UpdateState,
  message: string,
  checkedAt: string,
): UpdateState {
  return { ...state, status: "error", message, checkedAt };
}

export function reduceDownloadStart(state: UpdateState): UpdateState {
  return { ...state, status: "downloading", downloadPercent: 0, message: null };
}

export function reduceDownloadProgress(state: UpdateState, percent: number): UpdateState {
  return {
    ...state,
    status: "downloading",
    downloadPercent: Math.min(100, Math.max(0, Math.floor(percent))),
  };
}

export function reduceDownloadComplete(state: UpdateState, version: string): UpdateState {
  return {
    ...state,
    status: "downloaded",
    availableVersion: version,
    downloadedVersion: version,
    downloadPercent: 100,
    message: null,
  };
}

// the version is still known, so the failure is retryable as a download, not a check
export function reduceDownloadFailure(state: UpdateState, message: string): UpdateState {
  return { ...state, status: "error", downloadPercent: null, message };
}

export function reduceInstallFailure(state: UpdateState, message: string): UpdateState {
  return { ...state, status: "error", message };
}

// what one button does next; null while a step is running or nothing can be done
export function updateAction(state: UpdateState): UpdateAction | null {
  switch (state.status) {
    case "disabled":
    case "checking":
    case "downloading":
      return null;
    case "idle":
    case "up-to-date":
      return "check";
    case "available":
      return "download";
    case "downloaded":
      return "install";
    case "error":
      if (state.downloadedVersion !== null) return "install";
      if (state.availableVersion !== null) return "download";
      return "check";
  }
}
