// The updater's one state, reduced in the shell (src-tauri/src/update_state.rs) and parsed off the
// bridge by the page: a plain value, so a frame from a shell this page does not know fails at the
// parse. Each status carries exactly what it knows, so no surface reads a version that status
// cannot have. A found update downloads by itself and installs when the app quits; the one button
// checks, or once an update is ready, restarts to install it now.

import { z } from "zod";

const versionSchema = z.string().min(1);

const base = {
  checkedAt: z.string().nullable(),
  currentVersion: z.string().min(1),
};

export const updateStateSchema = z.discriminatedUnion("status", [
  // why nothing will be checked
  z.strictObject({ ...base, reason: z.string().min(1), status: z.literal("disabled") }),
  z.strictObject({ ...base, status: z.literal("idle") }),
  z.strictObject({ ...base, status: z.literal("checking") }),
  z.strictObject({ ...base, status: z.literal("up-to-date") }),
  z.strictObject({
    ...base,
    percent: z.number().int().min(0).max(100),
    status: z.literal("downloading"),
    version: versionSchema,
  }),
  // downloaded and verified: it installs when the app quits
  z.strictObject({ ...base, status: z.literal("ready"), version: versionSchema }),
  z.strictObject({ ...base, message: z.string().min(1), status: z.literal("error") }),
]);

export type UpdateState = z.infer<typeof updateStateSchema>;

// what the one button does next, with the version it acts on
export type UpdateAction = { action: "check" } | { action: "install"; version: string };

// null while a step is running or nothing can be done
export const updateAction = (state: UpdateState): UpdateAction | null => {
  switch (state.status) {
    case "disabled":
    case "checking":
    case "downloading": {
      return null;
    }
    case "idle":
    case "up-to-date":
    case "error": {
      return { action: "check" };
    }
    case "ready": {
      return { action: "install", version: state.version };
    }
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
};
