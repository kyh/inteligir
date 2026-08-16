// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed to this deployment's variables: bb's environment/project/storage
// ids have no meaning here; the thread id (and whatever the caller's
// baseShellEnv carries, e.g. the local server's port for the CLI) is what
// reaches the agent's shell.

import type { AgentRuntimeShellEnvironment } from "./types.js";

interface BuildThreadShellEnvironmentArgs {
  baseShellEnv: AgentRuntimeShellEnvironment | undefined;
  threadId: string;
}

export function buildThreadShellEnvironment(
  args: BuildThreadShellEnvironmentArgs,
): Record<string, string> {
  return {
    ...args.baseShellEnv,
    INTELIGIR_THREAD_ID: args.threadId,
  };
}
