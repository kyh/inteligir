// server.json names the bound port and the bearer together: dialling a derived port could reach a neighbouring
// checkout's server and write into its vault. no "point the CLI at a URL" hatch for the same reason: the token
// would still come from a data dir, and the two halves could disagree.

import { resolveAppConfig, type ResolveAppConfigArgs } from "./server/config";
import { readServerFile } from "./server/server-file";
import { CliExitError, EXIT_UNREACHABLE } from "./cli-error";

export const DATA_DIR_ENV_VAR = "INTELIGIR_DATA_DIR";

export interface ResolvedServer {
  baseUrl: string;
  // from the data dir, never the environment: an env var is inherited by every child.
  token: string;
  dataDir: string;
  vaultDir: string;
}

export interface ResolveServerArgs {
  env: NodeJS.ProcessEnv;
  checkoutPath: string;
  homeDir?: string;
}

export function resolveDataDir(args: ResolveServerArgs): string {
  const configArgs: ResolveAppConfigArgs = {
    checkoutPath: args.checkoutPath,
    env: args.env,
  };
  if (args.homeDir !== undefined) {
    configArgs.homeDir = args.homeDir;
  }
  return resolveAppConfig(configArgs).dataDir;
}

export function resolveServer(args: ResolveServerArgs): ResolvedServer {
  const dataDir = resolveDataDir(args);
  const server = readServerFile(dataDir);
  if (server === null) {
    throw new CliExitError(
      `No inteligir server is running for ${dataDir} (no readable server.json there).` +
        ` Start one with \`pnpm dev\`, or name another instance with ${DATA_DIR_ENV_VAR}.`,
      { code: "SERVER_UNREACHABLE", exitCode: EXIT_UNREACHABLE },
    );
  }
  return {
    baseUrl: `http://127.0.0.1:${String(server.port)}`,
    token: server.token,
    dataDir,
    vaultDir: server.vaultDir,
  };
}
