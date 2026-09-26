// Debug logging is a choice a Finder-launched app has no env var for, so the shell keeps it in its
// own userData, read before the first fork, and hands it to each server it forks. This owns the
// policy, over a file a test can point at a temp dir.

import { readFileSync } from "node:fs";
import { stagedWriteFileSync } from "inteligir/server/staged-write";
import { diagnosticsChoiceSchema } from "../diagnostics-state";
import type { DiagnosticsAnswer, DiagnosticsChoice, DiagnosticsState } from "../diagnostics-state";
import { toErrorMessage } from "../types";

export const DIAGNOSTICS_FILE_NAME = "diagnostics.json";

const OFF: DiagnosticsChoice = { debug: false };

const ADOPTED_REASON =
  "This server was started outside the app, so the app cannot change how it logs or restart it. Stop it and reopen Inteligir.";

const DEVELOPMENT_REASON = "A development build cannot relaunch itself. Quit and start it again.";

// a missing file is the default; bytes that are not a choice read as off and say so, rather than
// refusing a launch over a file the user never wrote
export const readDiagnosticsChoice = (
  filePath: string,
  warn: (message: string) => void,
): DiagnosticsChoice => {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return OFF;
  }
  try {
    return diagnosticsChoiceSchema.parse(JSON.parse(raw));
  } catch {
    warn(`${filePath} is not a diagnostics choice; debug logging stays off`);
    return OFF;
  }
};

const writeDiagnosticsChoice = (filePath: string, choice: DiagnosticsChoice): void => {
  stagedWriteFileSync(filePath, `${JSON.stringify(choice, null, 2)}\n`);
};

// what the server behind the window booted with; an adopted one ignored the choice entirely
type ServerRun = { kind: "owned"; debug: boolean } | { kind: "adopted" };

export interface DiagnosticsArgs {
  filePath: string;
  canRestart: boolean;
  // app.relaunch, then the ordinary quit, which stops the owned child and flushes its commit
  relaunch: () => void;
  warn: (message: string) => void;
}

export interface Diagnostics {
  // the choice the next fork runs with
  debug: () => boolean;
  recordRun: (run: ServerRun) => void;
  state: () => DiagnosticsState;
  setDebug: (debug: boolean) => DiagnosticsAnswer;
  restart: () => DiagnosticsAnswer;
}

export const createDiagnostics = (args: DiagnosticsArgs): Diagnostics => {
  let choice = readDiagnosticsChoice(args.filePath, args.warn);
  // the first fork takes the choice just read, so until a boot records otherwise this is true
  let run: ServerRun = { debug: choice.debug, kind: "owned" };
  // each relaunch call starts one more instance once this one exits
  let relaunching = false;

  const state = (): DiagnosticsState =>
    run.kind === "adopted"
      ? { debug: choice.debug, reason: ADOPTED_REASON, server: "adopted" }
      : {
          canRestart: args.canRestart,
          debug: choice.debug,
          restartRequired: run.debug !== choice.debug,
          server: "owned",
        };

  return {
    debug: () => choice.debug,
    recordRun: (next) => {
      run = next;
    },
    restart: () => {
      if (run.kind === "adopted") {
        return { ok: false, reason: ADOPTED_REASON };
      }
      if (!args.canRestart) {
        return { ok: false, reason: DEVELOPMENT_REASON };
      }
      if (!relaunching) {
        relaunching = true;
        args.relaunch();
      }
      return { ok: true, state: state() };
    },
    setDebug: (debug) => {
      if (run.kind === "adopted") {
        return { ok: false, reason: ADOPTED_REASON };
      }
      const next: DiagnosticsChoice = { debug };
      try {
        writeDiagnosticsChoice(args.filePath, next);
      } catch (error) {
        return { ok: false, reason: `The choice could not be saved: ${toErrorMessage(error)}` };
      }
      choice = next;
      return { ok: true, state: state() };
    },
    state,
  };
};
