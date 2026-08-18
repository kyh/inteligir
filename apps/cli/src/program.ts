// Program assembly + the run loop, kept apart from the bin entry so tests
// build the same program with injected deps and read the exit code as a
// value — no process.exit anywhere in command code.
//
// A failure prints in the SAME shape the invocation asked for: prose on
// stderr normally, an `{error, message}` envelope on stderr under --json (the
// server's own vocabulary, so a script branching on `.error` reads one set of
// classes end to end). Never on stdout: a --json caller parses stdout, and a
// refusal printed there is indistinguishable from an answer.
//
// citty's own entry point is `runMain`, and this cannot use it: it answers
// every failure with `process.exit(1)`, which would flatten the exit-code
// contract (2 = wait timeout, 3 = no server reachable) into one number and
// take the code out of this function's hands entirely. `runCommand` is the
// half of it that returns rather than exits, so the loop below is `runMain`'s
// shape — builtin flags, dispatch, one catch — with the code as its value.

import { readFileSync } from "node:fs";
import { runCommand, defineCommand, renderUsage, type CommandDef } from "citty";
import { CliExitError, EXIT_ERROR, getErrorMessage, invalidUsage } from "./cli-error";
import { argsOf, assertKnownFlags, resolveCommandPath } from "./command-tree";
import { connectorsCommand } from "./commands/connectors";
import { guideCommand } from "./commands/guide";
import { interactionsCommand } from "./commands/interactions";
import { backlinksCommand, relatedCommand, searchCommand, tagsCommand } from "./commands/knowledge";
import { proposalsCommand } from "./commands/proposals";
import { statusCommand } from "./commands/status";
import { threadCommand } from "./commands/thread";
import { vaultCommand } from "./commands/vault";
import { describeContext, type CliDeps } from "./context";
import { out, wantsJsonOutput, writeOut } from "./output";

/** package.json sits one level above this module in src/ AND in the dist/
 *  bundle, so one relative read serves both layouts. */
function readCliVersion(): string {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      typeof parsed.version === "string"
    ) {
      return parsed.version;
    }
  } catch {
    // Fall through to the placeholder.
  }
  return "0.0.0";
}

/**
 * The command factories deliberately declare no return type. `CommandDef<T>`
 * is CONTRAVARIANT in `T` through `run`, so a leaf that declares args — every
 * leaf — is not assignable to the bare `CommandDef` that would read as the
 * obvious annotation; citty's own `SubCommandsDef` dodges that with `any`, and
 * inference costs nothing where a type this repo would not write is the only
 * alternative.
 */
export function buildProgram(deps: CliDeps): CommandDef {
  return defineCommand({
    meta: {
      name: "inteligir",
      version: readCliVersion(),
      description: "Drive the local inteligir notes app — vault, search, agent threads",
    },
    subCommands: {
      vault: vaultCommand(deps),
      search: searchCommand(deps),
      backlinks: backlinksCommand(deps),
      related: relatedCommand(deps),
      tags: tagsCommand(deps),
      thread: threadCommand(deps),
      interactions: interactionsCommand(deps),
      connectors: connectorsCommand(deps),
      proposals: proposalsCommand(deps),
      status: statusCommand(deps),
      guide: guideCommand(deps),
    },
  });
}

const HELP_FLAGS = new Set(["--help", "-h"]);
const VERSION_FLAGS = new Set(["--version", "-v"]);

/** Flags stop counting after `--`, where the rest is a command's own payload. */
function hasBuiltinFlag(rawArgs: readonly string[], flags: ReadonlySet<string>): boolean {
  for (const raw of rawArgs) {
    if (raw === "--") {
      return false;
    }
    if (flags.has(raw)) {
      return true;
    }
  }
  return false;
}

/** Usage for the deepest command named, plus the context epilogue commander
 *  carried as `addHelpText("after")`. */
async function printHelp(program: CommandDef, rawArgs: readonly string[], deps: CliDeps) {
  const { command, parent } = resolveCommandPath(program, rawArgs);
  writeOut(`${await renderUsage(command, parent)}\n${describeContext(deps.env)}\n`);
}

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const rawArgs = argv.slice(2);
  const jsonMode = wantsJsonOutput(rawArgs);
  const program = buildProgram(deps);
  try {
    if (hasBuiltinFlag(rawArgs, HELP_FLAGS)) {
      await printHelp(program, rawArgs, deps);
      return 0;
    }
    if (rawArgs.length === 1 && hasBuiltinFlag(rawArgs, VERSION_FLAGS)) {
      writeOut(`${readCliVersion()}\n`);
      return 0;
    }
    const resolved = resolveCommandPath(program, rawArgs);
    if (resolved.command.run !== undefined) {
      assertKnownFlags(resolved.rest, argsOf(resolved.command));
    } else if (rawArgs.length === 0) {
      // What commander did with a bare program that has only subcommands.
      process.stderr.write(`${await renderUsage(program)}\n`);
      return EXIT_ERROR;
    }
    await runCommand(program, { rawArgs: [...rawArgs] });
    return 0;
  } catch (error) {
    const failure = asFailure(error);
    if (jsonMode) {
      process.stderr.write(
        `${JSON.stringify({ error: failure.code, message: failure.message })}\n`,
      );
    } else {
      out.error(failure.message);
    }
    return failure.exitCode;
  }
}

interface Failure {
  code: string;
  message: string;
  exitCode: number;
}

/**
 * citty raises a missing argument, an unknown command and a bad enum as its
 * own `CLIError`, which it does not export — so the class is recognised by
 * name. Every one of them is the caller's own mistake, which is the class
 * commander reported for the same inputs.
 */
function asFailure(error: unknown): Failure {
  if (error instanceof CliExitError) {
    return { code: error.code, message: error.message, exitCode: error.exitCode };
  }
  if (error instanceof Error && error.name === "CLIError") {
    const local = invalidUsage(error.message);
    return { code: local.code, message: local.message, exitCode: local.exitCode };
  }
  return { code: "unexpected", message: getErrorMessage(error), exitCode: EXIT_ERROR };
}
