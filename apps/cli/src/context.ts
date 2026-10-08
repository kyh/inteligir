import type { ContractRouterClient } from "@orpc/contract";
import type { LocalContract } from "@repo/contract/local";
import { systemOpenExternalUrl } from "./server/browser-opener";
import type { OpenExternalUrl } from "./server/browser-opener";
import { DATA_DIR_ENV_VAR, PROD_DATA_DIR_NAME, runtimeModeOf } from "./server/config";
import { resolveCheckoutRoot } from "./server/dev-instance";
import { createLocalClient } from "./server/local-client";
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
  openExternalUrl: OpenExternalUrl;
  resolveServer: () => ResolvedServer;
}

export const createCliDeps = (env: NodeJS.ProcessEnv = process.env): CliDeps => {
  let cached: ResolvedServer | null = null;
  return {
    env,
    openExternalUrl: systemOpenExternalUrl,
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

// generous because `action wait` is slow; it exists so a wedged server cannot hang a shell.
const CALL_TIMEOUT_MS = 120_000;

export const apiFor = (deps: Pick<CliDeps, "resolveServer">): Api => {
  const server = deps.resolveServer();
  return createLocalClient({
    origin: server.baseUrl,
    timeoutMs: CALL_TIMEOUT_MS,
    token: server.token,
  });
};

// a label, not the resolved dir: resolving reads config.json, and --help touches no state.
const derivedDataDirLabel = (env: NodeJS.ProcessEnv): string =>
  runtimeModeOf(env) === "prod"
    ? `(unset — derived under ~/${PROD_DATA_DIR_NAME})`
    : "(unset — derived from this checkout)";

export const describeContext = (env: NodeJS.ProcessEnv): string => {
  const dataDir = env[DATA_DIR_ENV_VAR]?.trim();
  return [
    "",
    "Environment:",
    `  ${DATA_DIR_ENV_VAR}: ${dataDir !== undefined && dataDir.length > 0 ? dataDir : derivedDataDirLabel(env)}`,
  ].join("\n");
};
