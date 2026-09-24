// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { THREAD_ID_ENV_VAR } from "@repo/domain/agent-shell-env";
import type { AgentRuntimeShellEnvironment } from "./types.js";

interface BuildThreadShellEnvironmentArgs {
  baseShellEnv: AgentRuntimeShellEnvironment | undefined;
  threadId: string;
}

export const buildThreadShellEnvironment = (
  args: BuildThreadShellEnvironmentArgs,
): AgentRuntimeShellEnvironment => {
  const env: AgentRuntimeShellEnvironment = { ...args.baseShellEnv };
  env[THREAD_ID_ENV_VAR] = args.threadId;
  return env;
};
