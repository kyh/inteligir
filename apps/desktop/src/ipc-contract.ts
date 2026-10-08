// Every command the page may ask the shell, declared once: its name as the shell's handler and
// build.rs name it, the arguments it takes and what it answers. The page parses every answer
// against its row and the shell parses every argument with serde
// (apps/desktop/src-tauri/src/commands.rs), so a frame from a build this end does not know fails
// at the parse. A refusal is an answer, never a rejection: a rejected command is a fault.

import { z } from "zod";
import {
  diagnosticsAnswerSchema,
  diagnosticsChoiceSchema,
  diagnosticsStateSchema,
} from "./diagnostics-state";
import { pathActionResultSchema } from "./path-action";
import { updateStateSchema } from "./update-state";

// the page asks, the shell answers
export interface CommandRoute<Args extends z.ZodType, Answer extends z.ZodType> {
  readonly command: string;
  readonly args: Args;
  readonly answer: Answer;
}

// the shell tells the page, unasked
export interface EventRoute<Payload extends z.ZodType> {
  readonly event: string;
  readonly payload: Payload;
}

const route = <Args extends z.ZodType, Answer extends z.ZodType>(
  command: string,
  args: Args,
  answer: Answer,
): CommandRoute<Args, Answer> => ({ answer, args, command });

// a command that takes nothing
const noArgs = z.undefined();

export const APP_COMMANDS = {
  diagnostics: {
    getState: route("diagnostics_get_state", noArgs, diagnosticsStateSchema),
    // the OS takes the folder or says why not
    openDataFolder: route("diagnostics_open_data_folder", noArgs, pathActionResultSchema),
    restart: route("diagnostics_restart", noArgs, diagnosticsAnswerSchema),
    setDebug: route("diagnostics_set_debug", diagnosticsChoiceSchema, diagnosticsAnswerSchema),
    showLog: route("diagnostics_show_log", noArgs, pathActionResultSchema),
  },
  updates: {
    check: route("updates_check", noArgs, updateStateSchema),
    download: route("updates_download", noArgs, updateStateSchema),
    getState: route("updates_get_state", noArgs, updateStateSchema),
    install: route("updates_install", noArgs, updateStateSchema),
  },
} as const;

export const UPDATE_STATE_EVENT: EventRoute<typeof updateStateSchema> = {
  event: "update-state",
  payload: updateStateSchema,
};
