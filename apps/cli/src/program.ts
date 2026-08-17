// Program assembly + the run loop, kept apart from the bin entry so tests
// build the same program with injected deps and read the exit code as a
// value — no process.exit anywhere in command code.
//
// A failure prints in the SAME shape the invocation asked for: prose on
// stderr normally, an `{error, message}` envelope on stderr under --json (the
// server's own vocabulary, so a script branching on `.error` reads one set of
// classes end to end). Never on stdout: a --json caller parses stdout, and a
// refusal printed there is indistinguishable from an answer.

import { readFileSync } from "node:fs";
import { Command, CommanderError } from "commander";
import { CliExitError, EXIT_ERROR, getErrorMessage } from "./cli-error";
import { registerGuideCommand } from "./commands/guide";
import { registerInteractionsCommands } from "./commands/interactions";
import { registerKnowledgeCommands } from "./commands/knowledge";
import { registerProposalCommands } from "./commands/proposals";
import { registerStatusCommand } from "./commands/status";
import { registerThreadCommands } from "./commands/thread";
import { registerVaultCommands } from "./commands/vault";
import { describeContext, type CliDeps } from "./context";

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

export function buildProgram(deps: CliDeps): Command {
  const program = new Command();
  program
    .name("inteligir")
    .description("Drive the local inteligir notes app — vault, search, agent threads")
    .version(readCliVersion());
  program.addHelpText("after", () => describeContext(deps.env));

  registerVaultCommands(program, deps);
  registerKnowledgeCommands(program, deps);
  registerThreadCommands(program, deps);
  registerInteractionsCommands(program, deps);
  registerProposalCommands(program, deps);
  registerStatusCommand(program, deps);
  registerGuideCommand(program, deps);
  return program;
}

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const program = buildProgram(deps);
  program.exitOverride();
  // Which OUTPUT MODE the invoked leaf asked for — known only once commander
  // has parsed it, and needed by the catch below. Closure state, never module
  // scope: two runCli calls in one process must not share it.
  let jsonMode = false;
  program.hook("preAction", (_program, actionCommand) => {
    jsonMode = actionCommand.opts().json === true;
  });
  try {
    await program.parseAsync([...argv]);
    return 0;
  } catch (error) {
    // commander throws these under exitOverride for --help/--version too,
    // where exitCode 0 is a success.
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    const failure =
      error instanceof CliExitError
        ? { code: error.code, message: error.message, exitCode: error.exitCode }
        : { code: "unexpected", message: getErrorMessage(error), exitCode: EXIT_ERROR };
    console.error(
      jsonMode
        ? JSON.stringify({ error: failure.code, message: failure.message })
        : `Error: ${failure.message}`,
    );
    return failure.exitCode;
  }
}
