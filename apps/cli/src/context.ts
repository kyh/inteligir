import type { ContractRouterClient } from "@orpc/contract";
import type { LocalContract } from "@repo/api/local";
import { THREAD_ID_ENV_VAR } from "@repo/domain/agent-shell-env";
import type { OpenExternalUrl } from "./server/browser-opener";
import { DATA_DIR_ENV_VAR, PROD_DATA_DIR_NAME, runtimeModeOf } from "./server/config";
import { resolveCheckoutRoot } from "./server/dev-instance";
import { createLocalClient } from "./server/local-client";
import type { LocalClientArgs } from "./server/local-client";
import { readCliVersion } from "./paths";
import { resolveServer } from "./server-discovery";
import type { ResolvedServer } from "./server-discovery";

export type Api = ContractRouterClient<LocalContract>;

export interface CliDeps {
  env: NodeJS.ProcessEnv;
  // the home the config derives from; a test points it at a scratch dir so a leaf that writes
  // config.json never reaches the developer's own
  homeDir?: string | undefined;
  // a test hands in its own so running a leaf never opens a browser on the developer's screen
  openExternalUrl?: OpenExternalUrl | undefined;
  resolveServer: () => ResolvedServer;
}

export const createCliDeps = (env: NodeJS.ProcessEnv = process.env): CliDeps => {
  let cached: ResolvedServer | null = null;
  return {
    env,
    resolveServer() {
      cached ??= resolveServer({
        checkoutPath: resolveCheckoutRoot(),
        cliVersion: readCliVersion(),
        env,
      });
      return cached;
    },
  };
};

// generous because `action wait` and a first-boot scan are slow; it exists so a wedged server cannot hang an agent's shell.
const CALL_TIMEOUT_MS = 120_000;

export const contextThreadId = (env: NodeJS.ProcessEnv): string | undefined => {
  const raw = env[THREAD_ID_ENV_VAR];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

// from an agent's shell every call names its thread, so a vault write it makes joins that turn's
// commit like one the agent's own tools made.
export const apiFor = (deps: CliDeps): Api => {
  const server = deps.resolveServer();
  const client: LocalClientArgs = {
    origin: server.baseUrl,
    timeoutMs: CALL_TIMEOUT_MS,
    token: server.token,
  };
  const threadId = contextThreadId(deps.env);
  if (threadId !== undefined) {
    client.agentThreadId = threadId;
  }
  return createLocalClient(client);
};

// the thread id is the only signal: the runtime injects it into agent shells and nowhere else.
export const isAgentShell = (env: NodeJS.ProcessEnv): boolean => contextThreadId(env) !== undefined;

// a label, not the resolved dir: resolving reads config.json, and --help touches no state.
const derivedDataDirLabel = (env: NodeJS.ProcessEnv): string =>
  runtimeModeOf(env) === "prod"
    ? `(unset — derived under ~/${PROD_DATA_DIR_NAME})`
    : "(unset — derived from this checkout)";

export const describeContext = (env: NodeJS.ProcessEnv): string => {
  const dataDir = env[DATA_DIR_ENV_VAR]?.trim();
  const threadId = contextThreadId(env);
  return [
    "",
    "Environment:",
    `  ${DATA_DIR_ENV_VAR}: ${dataDir !== undefined && dataDir.length > 0 ? dataDir : derivedDataDirLabel(env)}`,
    `  ${THREAD_ID_ENV_VAR}:  ${threadId ?? "(unset)"}`,
    "",
    "Run `inteligir guide` for the agent manual.",
  ].join("\n");
};
