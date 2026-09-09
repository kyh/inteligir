// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type { AgentRuntimeShellEnvironment } from "./types.js";

interface BuildThreadShellEnvironmentArgs {
  baseShellEnv: AgentRuntimeShellEnvironment | undefined;
  threadId: string;
}

export const buildThreadShellEnvironment = (
  args: BuildThreadShellEnvironmentArgs,
): AgentRuntimeShellEnvironment => {
  const env: AgentRuntimeShellEnvironment = { ...args.baseShellEnv };
  env.INTELIGIR_THREAD_ID = args.threadId;
  return env;
};
