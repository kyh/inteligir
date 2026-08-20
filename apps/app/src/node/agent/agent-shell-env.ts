// What the agent's SHELL gets: the server it can drive, and a PATH that can
// actually reach the CLI that drives it. Telling a model to run `inteligir`
// while the binary is not on its PATH is the whole feature failing quietly,
// so the bin directory is RESOLVED (never assumed) and the instructions only
// promise the command when it resolved.
//
// Layout resolution mirrors main.ts's `resolveEntryLayout`: this module runs
// either from source under tsx (apps/app/src/node/agent/ — the CLI package is
// a sibling of the app package) or from the bundled entry (dist-node/, one
// level under the app package). Both land on the same
// `<apps-dir>/cli/bin/inteligir`, which is checked for existence and the
// execute bit rather than assumed present.

import { accessSync, constants, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_BIN_NAME = "inteligir";

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The directory holding an executable `inteligir`, or null when this
 * deployment does not ship one. Candidates are the two layouts this module
 * runs in; each is verified on disk, so a wrong guess is null rather than a
 * PATH entry that resolves nothing.
 */
export function resolveCliBinDir(moduleUrl: string = import.meta.url): string | null {
  const here = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    // source: apps/app/src/node/agent → apps/cli/bin
    join(here, "..", "..", "..", "..", "cli", "bin"),
    // bundle: apps/app/dist-node → apps/cli/bin
    join(here, "..", "..", "cli", "bin"),
  ];
  for (const candidate of candidates) {
    if (isExecutableFile(join(candidate, CLI_BIN_NAME))) {
      return candidate;
    }
  }
  return null;
}

export interface AgentShellEnvArgs {
  /** Where this instance is listening — known only after listen. */
  serverUrl: string;
  /** The host process's environment, whose PATH the agent shell inherits. */
  env: NodeJS.ProcessEnv;
  cliBinDir: string | null;
}

/**
 * The env the runtime injects into the agent's shell. PATH is PREPENDED, not
 * replaced: the agent still needs git, node and everything else it inherits —
 * this only makes `inteligir` win over nothing.
 */
export function buildAgentShellEnv(args: AgentShellEnvArgs) {
  if (args.cliBinDir === null) {
    return { INTELIGIR_SERVER_URL: args.serverUrl };
  }
  const inheritedPath = args.env.PATH ?? "";
  return {
    INTELIGIR_SERVER_URL: args.serverUrl,
    PATH:
      inheritedPath.length === 0 ? args.cliBinDir : `${args.cliBinDir}${delimiter}${inheritedPath}`,
  };
}
