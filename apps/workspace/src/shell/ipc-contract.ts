// Every command the page may ask the shell, declared once: its name as the shell's handler and
// build.rs name it, the arguments it takes and what it answers. The page parses every answer
// against its row and the shell parses every argument with serde
// (apps/desktop/src-tauri/src/commands.rs), so a frame from a build this end does not know fails
// at the parse. A command that cannot do what it was asked rejects with the shell's error
// (`shell-error.ts`); a unit answer crosses as null.

import { z } from "zod";
import { keptCredentialSchema, shellConfigSchema } from "./shell-config";
import { updateStateSchema } from "./update-state";

// the page asks, the shell answers
export interface CommandRoute<Args extends z.ZodType, Answer extends z.ZodType> {
  readonly command: string;
  readonly args: Args;
  readonly answer: Answer;
}

// the page hands the shell a file as the request's raw body, its sha and its type in headers
export interface FileRoute<Answer extends z.ZodType> {
  readonly command: string;
  readonly shaHeader: string;
  readonly typeHeader: string;
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

const fileRoute = <Answer extends z.ZodType>(
  command: string,
  headers: { readonly sha: string; readonly type: string },
  answer: Answer,
): FileRoute<Answer> => ({ answer, command, shaHeader: headers.sha, typeHeader: headers.type });

// a command that takes nothing, and one that answers nothing
const noArgs = z.undefined();
const done = z.null();

// a value the replica binds or reads: the library's SQL holds text, numbers and null
const sqlValueSchema = z.union([z.string(), z.number(), z.null()]);
const statementArgs = z.strictObject({ params: z.array(sqlValueSchema), sql: z.string().min(1) });
const rowsSchema = z.array(z.record(z.string(), sqlValueSchema));
// a transaction the shell holds open between statements
const tokenSchema = z.number().int().positive();
const tokenArgs = z.strictObject({ token: tokenSchema });
const transactionArgs = statementArgs.extend({ token: tokenSchema });

const shaArgs = z.strictObject({ sha: z.string().regex(/^[0-9a-f]{64}$/u) });
// a file's bytes, as the shell's raw answer arrives
const bytesSchema = z.instanceof(ArrayBuffer).transform((buffer) => new Uint8Array(buffer));

export const APP_COMMANDS = {
  config: route("shell_config", noArgs, shellConfigSchema),
  credential: {
    // signs this Mac out: the credential, the replica's file and every file of the account go
    forget: route("credential_forget", noArgs, done),
    keep: route("credential_keep", z.strictObject({ credential: keptCredentialSchema }), done),
    // the credential a sign-in kept, with its account's replica open; null when signed out
    restore: route("credential_restore", noArgs, keptCredentialSchema.nullable()),
  },
  files: {
    clearStaged: route("files_clear_staged", noArgs, done),
    // the type is the one the outbox uploads it as, which the shell serves it as meanwhile
    stage: fileRoute("files_stage", { sha: "x-file-sha", type: "x-file-type" }, done),
    // a staged file's bytes; one this Mac no longer holds rejects `missing`
    staged: route("files_staged", shaArgs, bytesSchema),
    // the write naming it landed, so the cloud holds it
    unstage: route("files_unstage", shaArgs, done),
  },
  leaving: {
    // the page wrote what it held, as the shell's `leaving` event asked before a quit or a restart
    ready: route("leaving_ready", noArgs, done),
  },
  replica: {
    all: route("replica_all", statementArgs, rowsSchema),
    begin: route("replica_begin", noArgs, tokenSchema),
    commit: route("replica_commit", tokenArgs, done),
    rollback: route("replica_rollback", tokenArgs, done),
    run: route("replica_run", statementArgs, done),
    txAll: route("replica_tx_all", transactionArgs, rowsSchema),
    txRun: route("replica_tx_run", transactionArgs, done),
  },
  updates: {
    check: route("updates_check", noArgs, updateStateSchema),
    getState: route("updates_get_state", noArgs, updateStateSchema),
    // Restart to Update: installs the ready update and relaunches
    install: route("updates_install", noArgs, updateStateSchema),
  },
} as const;

export const UPDATE_STATE_EVENT: EventRoute<typeof updateStateSchema> = {
  event: "update-state",
  payload: updateStateSchema,
};

// the shell is about to quit or restart, and waits a moment for the page to write what it holds
export const LEAVING_EVENT: EventRoute<typeof done> = {
  event: "leaving",
  payload: done,
};
