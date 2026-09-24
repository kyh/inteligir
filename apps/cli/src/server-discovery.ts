// server.json names the bound port and the bearer together: dialling a derived port could reach a neighbouring
// checkout's server and write into its vault. no "point the CLI at a URL" hatch for the same reason: the token
// would still come from a data dir, and the two halves could disagree.

import { DATA_DIR_ENV_VAR, resolveAppConfig } from "./server/config";
import type { ResolveAppConfigArgs } from "./server/config";
import { loopbackOrigin, readServerFile } from "./server/server-file";
import { processAlive } from "./server/server-probe";
import { CliExitError, START_SERVER_HINT } from "./cli-error";

export interface ResolvedServer {
  baseUrl: string;
  // from the data dir, never the environment: an env var is inherited by every child.
  token: string;
  dataDir: string;
  vaultDir: string;
}

export interface ResolveDataDirArgs {
  env: NodeJS.ProcessEnv;
  checkoutPath: string;
  homeDir?: string;
}

export interface ResolveServerArgs extends ResolveDataDirArgs {
  // this binary's own release, which the server must share.
  cliVersion: string;
}

export const resolveDataDir = (args: ResolveDataDirArgs): string => {
  const configArgs: ResolveAppConfigArgs = {
    checkoutPath: args.checkoutPath,
    env: args.env,
  };
  if (args.homeDir !== undefined) {
    configArgs.homeDir = args.homeDir;
  }
  return resolveAppConfig(configArgs).dataDir;
};

const versionMismatch = (
  dataDir: string,
  serverVersion: string | undefined,
  cliVersion: string,
): CliExitError =>
  new CliExitError(
    serverVersion === undefined
      ? `The inteligir server for ${dataDir} is older than this CLI (${cliVersion}): it names no release.` +
          " Update the app, or restart `inteligir serve` from a matching install."
      : `The inteligir server for ${dataDir} is ${serverVersion} (the desktop app or \`inteligir serve\`),` +
          ` and this CLI is ${cliVersion}. Install the matching CLI (\`npm i -g inteligir@${serverVersion}\`)` +
          " or update the app.",
    { code: "SERVER_VERSION_MISMATCH" },
  );

export const resolveServer = (args: ResolveServerArgs): ResolvedServer => {
  const dataDir = resolveDataDir(args);
  const server = readServerFile(dataDir);
  if (server === null) {
    throw new CliExitError(
      `No inteligir server is running for ${dataDir} (no readable server.json there).` +
        ` ${START_SERVER_HINT}, or name another instance with ${DATA_DIR_ENV_VAR}.`,
      { code: "SERVER_UNREACHABLE" },
    );
  }
  // ahead of the version: a crash leaves its row behind, and one naming another release would send
  // the user to install a CLI for a server that is not there.
  if (!processAlive(server.pid)) {
    throw new CliExitError(
      `server.json in ${dataDir} names pid ${String(server.pid)}, which is not running (left by a crash).` +
        ` ${START_SERVER_HINT}.`,
      { code: "SERVER_UNREACHABLE" },
    );
  }
  // /local may break between releases and the client checks no response's shape, so a call across
  // two would fail opaquely or misread its answer; exact equality, because any release may break it.
  if (server.version !== args.cliVersion) {
    throw versionMismatch(dataDir, server.version, args.cliVersion);
  }
  return {
    baseUrl: loopbackOrigin(server.port),
    dataDir,
    token: server.token,
    vaultDir: server.vaultDir,
  };
};
