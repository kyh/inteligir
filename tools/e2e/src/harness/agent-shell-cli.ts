import path from "node:path";
import { resolveCliBinDir, toShellEnv } from "inteligir/server/agent-shell-env";
import { expect } from "./assert";
import { exec, hermeticProcessEnv } from "./exec";
import type { ExecResult } from "./exec";

export type AgentShellCli = (...argv: string[]) => Promise<ExecResult>;

// the env composed by the server's own resolver, so a broken PATH or a missing bin fails here; the
// bare name through that PATH, as an agent's bash finds it, since an absolute path would leave that
// flow untested.
export const agentShellCli = (repoRoot: string, dataDir: string): AgentShellCli => {
  const cliBinDir = resolveCliBinDir(path.join(repoRoot, "apps", "cli", "bin"));
  expect(cliBinDir !== null, "the app resolves a CLI bin directory for the agent's PATH");
  const env = {
    ...hermeticProcessEnv(),
    ...toShellEnv({ cliBinDir, connectedDirs: [], dataDir, skillsDir: null }, hermeticProcessEnv()),
  };
  return async (...argv) => await exec("inteligir", argv, { env, timeoutMs: 60_000 });
};
