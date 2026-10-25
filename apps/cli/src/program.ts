// not citty's runMain: it answers every failure with process.exit(1), flattening the exit-code contract
// (each class's own, in cli-error.ts). failures go to stderr only: a --json caller parses stdout.

import { stripVTControlCharacters } from "node:util";
import { runCommand, defineCommand, renderUsage } from "citty";
import type { CommandDef } from "citty";
import { z } from "zod";
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
import { guideCommand } from "./commands/guide";
import {
  backlinksCommand,
  matchesCommand,
  relatedCommand,
  searchCommand,
  tagsCommand,
} from "./commands/knowledge";
import { importCommand } from "./commands/import";
import { itemCommand } from "./commands/item";
import { itemsCommand } from "./commands/items";
import { nativeHostCommand } from "./commands/native-host";
import { openCommand } from "./commands/open";
import { saveCommand } from "./commands/save";
import { statusCommand } from "./commands/status";
import { tagCommand } from "./commands/tag";
import { cloudCommand } from "./commands/cloud";
import { actionCommand } from "./commands/action";
import { annotationCommand } from "./commands/annotation";
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
      description:
        "Run the local inteligir library app, and drive it — save, items, tags, search, agent actions",
      name: "inteligir",
      version: readCliVersion(),
    },
    subCommands: {
      action: actionCommand(deps),
      agents: agentsCommand(deps),
      annotation: annotationCommand(deps),
      backlinks: backlinksCommand(deps),
      cloud: cloudCommand(deps),
      guide: guideCommand(deps),
      import: importCommand(deps),
      item: itemCommand(deps),
      items: itemsCommand(deps),
      matches: matchesCommand(deps),
      "native-host": nativeHostCommand(deps),
      open: openCommand(deps),
      related: relatedCommand(deps),
      save: saveCommand(deps),
      search: searchCommand(deps),
      serve: serveCommand(),
      status: statusCommand(deps),
      tag: tagCommand(deps),
      tags: tagsCommand(deps),
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

// a leaf that speaks a protocol of its own (native-host's frames) cannot print a failure line, so it
// answers its exit code through process.exitCode; read once and put back, so one run never sees
// another's.
const leafExitCodeSchema = z.number().int();

const runLeaf = async (program: CommandDef, rawArgs: readonly string[]): Promise<number> => {
  const inherited = process.exitCode;
  process.exitCode = undefined;
  try {
    await runCommand(program, { rawArgs: [...rawArgs] });
    const answered = leafExitCodeSchema.safeParse(process.exitCode);
    return answered.success ? answered.data : 0;
  } finally {
    process.exitCode = inherited;
  }
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
    return await runLeaf(program, rawArgs);
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
