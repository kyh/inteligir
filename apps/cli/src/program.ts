// not citty's runMain: it answers every failure with process.exit(1), flattening the exit-code contract
// (each class's own, in cli-error.ts). failures go to stderr only: a --json caller parses stdout.

import { stripVTControlCharacters } from "node:util";
import { runCommand, defineCommand, renderUsage } from "citty";
import type { CommandDef } from "citty";
import {
  CliExitError,
  EXIT_ERROR,
  START_SERVER_HINT,
  getErrorMessage,
  invalidUsage,
  isOrpcError,
  isUnreachable,
} from "./cli-error";
import {
  HELP_FLAGS,
  VERSION_FLAGS,
  argsOf,
  assertKnownFlags,
  assertPositionalArity,
  resolveCommandPath,
} from "./command-tree";
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
import { openCommand } from "./commands/open";
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
      open: openCommand(deps),
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

// citty picks colour once, at import, from the environment alone, so a pipe gets escapes unless they are cut here.
const forStream = (text: string, stream: NodeJS.WriteStream): string =>
  stream.isTTY ? text : stripVTControlCharacters(text);

const printHelp = async (program: CommandDef, rawArgs: readonly string[], deps: CliDeps) => {
  const { command, parent } = resolveCommandPath(program, rawArgs);
  const usage = await renderUsage(command, parent);
  writeOut(forStream(`${usage}\n${describeContext(deps.env)}\n`, process.stdout));
};

// citty's CLIError (missing argument, unknown command, bad enum) is not exported, so it is recognised by name.
// its colour is stripped whatever the stream: a message is data, and a --json caller parses it.
const asCliExitError = (cause: unknown): CliExitError => {
  if (cause instanceof CliExitError) {
    return cause;
  }
  if (isOrpcError(cause)) {
    return new CliExitError(cause.message, { serverClass: cause.code });
  }
  if (cause instanceof Error && cause.name === "CLIError") {
    return invalidUsage(stripVTControlCharacters(cause.message));
  }
  const message = getErrorMessage(cause);
  if (isUnreachable(cause)) {
    return new CliExitError(`${message} — no inteligir server answered. ${START_SERVER_HINT}.`, {
      code: "SERVER_UNREACHABLE",
    });
  }
  return new CliExitError(message, { code: "UNEXPECTED" });
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
      // citty hands a leaf only the argv after its name, so a flag before the name is never parsed: `--json vault
      // read x` would print human text and exit 0. refused rather than hoisted, since a valued flag there loses its
      // value to the name walk (`--limit 5 action list`); only the remainder is left to check.
      const prefix = rawArgs.slice(0, rawArgs.length - resolved.rest.length);
      if (prefix.some((token) => token.startsWith("-"))) {
        throw invalidUsage("put flags after the command's name: inteligir <command> … --flag");
      }
      assertKnownFlags(resolved.rest, argsOf(resolved.command));
      assertPositionalArity(resolved.rest, argsOf(resolved.command));
    } else if (rawArgs.length === 0) {
      process.stderr.write(forStream(`${await renderUsage(program)}\n`, process.stderr));
      return EXIT_ERROR;
    }
    await runCommand(program, { rawArgs: [...rawArgs] });
    return 0;
  } catch (error) {
    const failure = asCliExitError(error);
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
