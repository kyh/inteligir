// The updater's one state, reduced in the shell (src-tauri/src/update_state.rs)
// and parsed off the bridge by the page: a plain value, so a frame from a shell
// this page does not know fails at the parse. Each status carries exactly what
// it knows, so no surface reads a version that status cannot have.

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
