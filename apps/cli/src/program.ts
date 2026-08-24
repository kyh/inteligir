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

import { ORPCError } from "@orpc/client";
import { runCommand, defineCommand, renderUsage, type CommandDef } from "citty";
import {
  CliExitError,
  EXIT_ERROR,
  EXIT_UNREACHABLE,
  getErrorMessage,
  invalidUsage,
  isUnreachable,
} from "./cli-error";
import { argsOf, assertKnownFlags, resolveCommandPath } from "./command-tree";
import { connectorsCommand } from "./commands/connectors";
import { foldersCommand } from "./commands/folders";
import { guideCommand } from "./commands/guide";
import { interactionsCommand } from "./commands/interactions";
import { backlinksCommand, relatedCommand, searchCommand, tagsCommand } from "./commands/knowledge";
import { statusCommand } from "./commands/status";
import { syncCommand } from "./commands/sync";
import { trashCommand } from "./commands/trash";
import { actionCommand } from "./commands/action";
import { commentCommand } from "./commands/comment";
import { serveCommand } from "./commands/serve";
import { vaultCommand } from "./commands/vault";
import { describeContext, type CliDeps } from "./context";
import { readCliVersion } from "./paths";
import { out, wantsJsonOutput, writeOut } from "./output";

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
      description: "Run the local inteligir notes app, and drive it — vault, search, agent actions",
    },
    subCommands: {
      serve: serveCommand(),
      vault: vaultCommand(deps),
      search: searchCommand(deps),
      backlinks: backlinksCommand(deps),
      related: relatedCommand(deps),
      tags: tagsCommand(deps),
      action: actionCommand(deps),
      comment: commentCommand(deps),
      interactions: interactionsCommand(deps),
      connectors: connectorsCommand(deps),
      folders: foldersCommand(deps),
      trash: trashCommand(deps),
      sync: syncCommand(deps),
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
 * THE one place a refusal becomes an exit. A server refusal arrives as a
 * thrown `ORPCError` carrying the contract's own class, so it passes through
 * with its class intact — and because it is thrown rather than returned, no
 * command can reach a body that does not exist. That invariant used to need a
 * status-checking chokepoint every command had to remember to call.
 *
 * citty raises a missing argument, an unknown command and a bad enum as its
 * own `CLIError`, which it does not export — so the class is recognised by
 * name. Every one of them is the caller's own mistake.
 */
function asFailure(cause: unknown): Failure {
  if (cause instanceof CliExitError) {
    return { code: cause.code, message: cause.message, exitCode: cause.exitCode };
  }
  if (cause instanceof ORPCError) {
    return { code: cause.code, message: cause.message, exitCode: EXIT_ERROR };
  }
  if (cause instanceof Error && cause.name === "CLIError") {
    const local = invalidUsage(cause.message);
    return { code: local.code, message: local.message, exitCode: local.exitCode };
  }
  const message = getErrorMessage(cause);
  if (isUnreachable(cause)) {
    // Discovery answers this class when there is no `server.json`; a stale one
    // (a crash skips the ordered shutdown that removes it) reaches the dial
    // instead, and the class has to mean the same thing either way.
    return {
      code: "SERVER_UNREACHABLE",
      message: `${message} — no inteligir server answered. Start one with \`inteligir serve\`.`,
      exitCode: EXIT_UNREACHABLE,
    };
  }
  return { code: "UNEXPECTED", message, exitCode: EXIT_ERROR };
}
