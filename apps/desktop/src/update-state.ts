// The updater's one state, reduced in main and parsed off the bridge by the
// page: a plain value, so the renderer never holds electron-updater's objects
// and a frame from a main this page does not know fails at the parse. Each
// status carries exactly what it knows, so no surface reads a version that
// status cannot have.

import { z } from "zod";

const versionSchema = z.string().min(1);

// what one click does next, with the version it acts on
const updateActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check") }).strict(),
  z.object({ action: z.literal("download"), version: versionSchema }).strict(),
  z.object({ action: z.literal("install"), version: versionSchema }).strict(),
]);
export type UpdateAction = z.infer<typeof updateActionSchema>;

const updateBaseSchema = z.object({
  checkedAt: z.string().nullable(),
  currentVersion: z.string().min(1),
});

export const updateStateSchema = z.discriminatedUnion("status", [
  updateBaseSchema
    .extend({
      // why nothing will be checked
      reason: z.string().min(1),
      status: z.literal("disabled"),
    })
    .strict(),
  updateBaseSchema.extend({ status: z.literal("idle") }).strict(),
  updateBaseSchema
    .extend({
      // what the button offered before the check: a failure offers it again, and a
      // downloaded update survives whatever the check answers
      retry: updateActionSchema,
      status: z.literal("checking"),
    })
    .strict(),
  updateBaseSchema.extend({ status: z.literal("up-to-date") }).strict(),
  updateBaseSchema.extend({ status: z.literal("available"), version: versionSchema }).strict(),
  updateBaseSchema
    .extend({
      percent: z.number().int().min(0).max(100),
      status: z.literal("downloading"),
      version: versionSchema,
    })
    .strict(),
  updateBaseSchema.extend({ status: z.literal("downloaded"), version: versionSchema }).strict(),
  updateBaseSchema
    .extend({ message: z.string().min(1), retry: updateActionSchema, status: z.literal("error") })
    .strict(),
]);

export type UpdateState = z.infer<typeof updateStateSchema>;

const CHECK: UpdateAction = { action: "check" };

export const initialUpdateState = (
  currentVersion: string,
  disabledReason: string | null,
): UpdateState =>
  disabledReason === null
    ? { checkedAt: null, currentVersion, status: "idle" }
    : { checkedAt: null, currentVersion, reason: disabledReason, status: "disabled" };

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
      return CHECK;
    }
    case "available": {
      return { action: "download", version: state.version };
    }
    case "downloaded": {
      return { action: "install", version: state.version };
    }
    case "error": {
      return state.retry;
    }
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
};

// what a failure leaves the button offering: the update already found, else a fresh check
const retryAfter = (state: UpdateState): UpdateAction => {
  switch (state.status) {
    case "checking": {
      return state.retry;
    }
    case "downloading": {
      return { action: "download", version: state.version };
    }
    default: {
      return updateAction(state) ?? CHECK;
    }
  }
};

const keptDownload = (state: UpdateState): string | null => {
  const retry = retryAfter(state);
  return retry.action === "install" ? retry.version : null;
};

const base = (state: UpdateState, checkedAt: string | null = state.checkedAt) => ({
  checkedAt,
  currentVersion: state.currentVersion,
});

// a disabled updater never runs a step, so no event moves it
export const reduceCheckStart = (state: UpdateState, checkedAt: string): UpdateState =>
  state.status === "disabled"
    ? state
    : { ...base(state, checkedAt), retry: retryAfter(state), status: "checking" };

export const reduceUpdateAvailable = (
  state: UpdateState,
  version: string,
  checkedAt: string,
): UpdateState => {
  if (state.status === "disabled") {
    return state;
  }
  // a newer version than the one on disk is a fresh download, not the old one
  return keptDownload(state) === version
    ? { ...base(state, checkedAt), status: "downloaded", version }
    : { ...base(state, checkedAt), status: "available", version };
};

export const reduceNoUpdate = (state: UpdateState, checkedAt: string): UpdateState => {
  if (state.status === "disabled") {
    return state;
  }
  const kept = keptDownload(state);
  return kept === null
    ? { ...base(state, checkedAt), status: "up-to-date" }
    : { ...base(state, checkedAt), status: "downloaded", version: kept };
};

export const reduceDownloadStart = (state: UpdateState, version: string): UpdateState =>
  state.status === "disabled"
    ? state
    : { ...base(state), percent: 0, status: "downloading", version };

// the same state when nothing moved, so a caller can skip a broadcast by identity
export const reduceDownloadProgress = (state: UpdateState, percent: number): UpdateState => {
  if (state.status !== "downloading") {
    return state;
  }
  const next = Math.min(100, Math.max(0, Math.floor(percent)));
  return next === state.percent ? state : { ...state, percent: next };
};

export const reduceDownloadComplete = (state: UpdateState, version: string): UpdateState =>
  state.status === "disabled" ? state : { ...base(state), status: "downloaded", version };

// a failed download keeps its version and a failed install its bytes, so the retry is that step
export const reduceFailure = (
  state: UpdateState,
  message: string,
  checkedAt: string | null = state.checkedAt,
): UpdateState =>
  state.status === "disabled"
    ? state
    : { ...base(state, checkedAt), message, retry: retryAfter(state), status: "error" };
