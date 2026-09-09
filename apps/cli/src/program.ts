// not citty's runMain: it answers every failure with process.exit(1), flattening the exit-code contract
// (2 wait timeout, 3 unreachable). failures go to stderr only: a --json caller parses stdout.

import { ORPCError } from "@orpc/client";
import { runCommand, defineCommand, renderUsage } from "citty";
import type { CommandDef } from "citty";
import {
  CliExitError,
  EXIT_ERROR,
  EXIT_UNREACHABLE,
  getErrorMessage,
  invalidUsage,
  isUnreachable,
} from "./cli-error";
import { argsOf, assertKnownFlags, resolveCommandPath } from "./command-tree";
import { agentsCommand } from "./commands/agents";
import { connectorsCommand } from "./commands/connectors";
import { foldersCommand } from "./commands/folders";
import { guideCommand } from "./commands/guide";
import { interactionsCommand } from "./commands/interactions";
import {
  backlinksCommand,
  matchesCommand,
  problemsCommand,
  unlinkedCommand,
  relatedCommand,
  searchCommand,
  tagsCommand,
} from "./commands/knowledge";
import { statusCommand } from "./commands/status";
import { tagCommand } from "./commands/tag";
import { cloudCommand } from "./commands/cloud";
import { actionCommand } from "./commands/action";
import { commentCommand } from "./commands/comment";
import { serveCommand } from "./commands/serve";
import { vaultCommand } from "./commands/vault";
import { describeContext } from "./context";
import type { CliDeps } from "./context";
import { readCliVersion } from "./paths";
import { out, wantsJsonOutput, writeOut } from "./output";

// the command factories declare no return type: CommandDef<T> is contravariant in T through `run`, so a leaf
// with args is not assignable to bare CommandDef (citty's own SubCommandsDef dodges that with `any`).
export const buildProgram = (deps: CliDeps): CommandDef =>
  defineCommand({
    meta: {
      description: "Run the local inteligir notes app, and drive it — vault, search, agent actions",
      name: "inteligir",
      version: readCliVersion(),
    },
    subCommands: {
      action: actionCommand(deps),
      agents: agentsCommand(deps),
      backlinks: backlinksCommand(deps),
      cloud: cloudCommand(deps),
      comment: commentCommand(deps),
      connectors: connectorsCommand(deps),
      folders: foldersCommand(deps),
      guide: guideCommand(deps),
      interactions: interactionsCommand(deps),
      matches: matchesCommand(deps),
      problems: problemsCommand(deps),
      related: relatedCommand(deps),
      search: searchCommand(deps),
      serve: serveCommand(),
      status: statusCommand(deps),
      tag: tagCommand(deps),
      tags: tagsCommand(deps),
      unlinked: unlinkedCommand(deps),
      vault: vaultCommand(deps),
    },
  });

const HELP_FLAGS = new Set(["--help", "-h"]);
const VERSION_FLAGS = new Set(["--version", "-v"]);

const hasBuiltinFlag = (rawArgs: readonly string[], flags: ReadonlySet<string>): boolean => {
  for (const raw of rawArgs) {
    if (raw === "--") {
      return false;
    }
    if (flags.has(raw)) {
      return true;
    }
  }
  return false;
};

const printHelp = async (program: CommandDef, rawArgs: readonly string[], deps: CliDeps) => {
  const { command, parent } = resolveCommandPath(program, rawArgs);
  writeOut(`${await renderUsage(command, parent)}\n${describeContext(deps.env)}\n`);
};

interface Failure {
  code: string;
  message: string;
  exitCode: number;
}

// unparameterised, `instanceof ORPCError` narrows `code` to `any`.
const isOrpcError = (cause: unknown): cause is ORPCError<string, unknown> =>
  cause instanceof ORPCError;

// citty's CLIError (missing argument, unknown command, bad enum) is not exported, so it is recognised by name.
const asFailure = (cause: unknown): Failure => {
  if (cause instanceof CliExitError) {
    return { code: cause.code, exitCode: cause.exitCode, message: cause.message };
  }
  if (isOrpcError(cause)) {
    return { code: cause.code, exitCode: EXIT_ERROR, message: cause.message };
  }
  if (cause instanceof Error && cause.name === "CLIError") {
    const local = invalidUsage(cause.message);
    return { code: local.code, exitCode: local.exitCode, message: local.message };
  }
  const message = getErrorMessage(cause);
  if (isUnreachable(cause)) {
    return {
      code: "SERVER_UNREACHABLE",
      exitCode: EXIT_UNREACHABLE,
      message: `${message} — no inteligir server answered. Start one with \`inteligir serve\`.`,
    };
  }
  return { code: "UNEXPECTED", exitCode: EXIT_ERROR, message };
};

export const runCli = async (argv: readonly string[], deps: CliDeps): Promise<number> => {
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
      // the whole argv, not the post-name remainder: a flag typed before the subcommand name would slip past the gate.
      assertKnownFlags(rawArgs, argsOf(resolved.command));
    } else if (rawArgs.length === 0) {
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
};
