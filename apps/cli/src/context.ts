import type { ContractRouterClient } from "@orpc/contract";
import type { LocalContract } from "@repo/api/local";
import { resolveCheckoutRoot } from "./server/dev-instance";
import { createLocalClient } from "./server/local-client";
import { DATA_DIR_ENV_VAR, resolveServer, type ResolvedServer } from "./server-discovery";

export type Api = ContractRouterClient<LocalContract>;

const THREAD_ID_ENV_VAR = "INTELIGIR_THREAD_ID";

export interface CliDeps {
  env: NodeJS.ProcessEnv;
  // the home the config derives from; a test points it at a scratch dir so a leaf that writes
  // config.json never reaches the developer's own
  homeDir?: string | undefined;
  resolveServer(): ResolvedServer;
}

export function createCliDeps(env: NodeJS.ProcessEnv = process.env): CliDeps {
  let cached: ResolvedServer | null = null;
  return {
    env,
    resolveServer() {
      cached ??= resolveServer({ env, checkoutPath: resolveCheckoutRoot() });
      return cached;
    },
  };
}

// generous because `action wait` and a first-boot scan are slow; it exists so a wedged server cannot hang an agent's shell.
const CALL_TIMEOUT_MS = 120_000;

export function apiFor(deps: CliDeps): Api {
  const server = deps.resolveServer();
  return createLocalClient({
    origin: server.baseUrl,
    token: server.token,
    timeoutMs: CALL_TIMEOUT_MS,
  });
}

export function contextThreadId(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env[THREAD_ID_ENV_VAR];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

// the thread id is the only signal: the runtime injects it into agent shells and nowhere else.
export function isAgentShell(env: NodeJS.ProcessEnv): boolean {
  return contextThreadId(env) !== undefined;
}

export function describeContext(env: NodeJS.ProcessEnv): string {
  const dataDir = env[DATA_DIR_ENV_VAR]?.trim();
  const threadId = contextThreadId(env);
  return [
    "",
    "Environment:",
    `  ${DATA_DIR_ENV_VAR}: ${dataDir !== undefined && dataDir.length > 0 ? dataDir : "(unset — derived from this checkout)"}`,
    `  ${THREAD_ID_ENV_VAR}:  ${threadId ?? "(unset)"}`,
    "",
    "Run `inteligir guide` for the agent manual.",
  ].join("\n");
}
