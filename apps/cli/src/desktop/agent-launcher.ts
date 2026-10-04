// An agent drives the app by typing `inteligir …` in its shell. This package's own bin is a node
// script found through `#!/usr/bin/env node`, and the Mac the desktop app runs on may have no node
// at all, so the app hands agent shells a launcher of its own instead: a `sh` script that runs the
// node the app ships on the CLI the app ships, written to the data dir at each boot, since the app
// may have moved since the last.

import path from "node:path";
import { stagedWriteFileSync } from "../server/staged-write";

export const AGENT_BIN_DIR_NAME = "bin";
const CLI_BIN_NAME = "inteligir";

// single-quoted for sh: a quote inside ends the quoting, is escaped, and starts it again
const shellQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;

export interface AgentLauncherArgs {
  dataDir: string;
  node: string;
  cliEntry: string;
  // the mode the server runs in, which the CLI must read the same way to find it
  nodeEnv: string;
}

const agentLauncherScript = (args: Omit<AgentLauncherArgs, "dataDir">): string =>
  [
    "#!/bin/sh",
    "# written by the Inteligir app at each boot: the node and the CLI it ships",
    `NODE_ENV=${shellQuote(args.nodeEnv)} exec ${shellQuote(args.node)} ${shellQuote(args.cliEntry)} "$@"`,
    "",
  ].join("\n");

// answers the folder to put first on an agent shell's PATH
export const writeAgentLauncher = (args: AgentLauncherArgs): string => {
  const dir = path.join(args.dataDir, AGENT_BIN_DIR_NAME);
  const file = path.join(dir, CLI_BIN_NAME);
  stagedWriteFileSync(file, agentLauncherScript(args), { mode: 0o755 });
  return dir;
};
