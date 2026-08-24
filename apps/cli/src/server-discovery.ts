// WHICH SERVER, AND MAY I TALK TO IT? Both answers come out of ONE file, and
// that is the point: `<dataDir>/server.json` carries the BOUND port and the
// bearer together, so the address and the credential can never disagree.
//
// There is no probing left. A derived dev port may have been probed upward at
// bind, so a client that dialled the derived value could reach a NEIGHBOURING
// checkout's server — and writing a note into someone else's vault is a
// silent, destructive wrong answer. The file names the port that answered, so
// the ambiguity has nowhere to live; and a squatter holding the port cannot
// have written the file, so a wrong responder refuses the token instead of
// being adopted.
//
// WHICH data dir is still this CLI's own question, and it reuses the app's
// resolution rather than re-deriving it — `./server/config` drags only
// node builtins and zod, so importing it is cheaper than a second, divergent
// copy of the layering (env → `<dataDir>/config.json` → per-checkout default).
//
// There is deliberately NO "point the CLI at a URL" escape hatch. Under a
// bearer model naming a URL is naming somewhere to SEND A CREDENTIAL, and the
// token would still have to come from a local data dir — so the two halves
// could disagree, which is the exact failure this file exists to remove.
// `INTELIGIR_DATA_DIR` names the instance instead; the runtime injects it into
// agent shells for the same reason.

import { resolveAppConfig, type ResolveAppConfigArgs } from "./server/config";
import { readServerFile } from "./server/server-file";
import { CliExitError, EXIT_UNREACHABLE } from "./cli-error";

export const DATA_DIR_ENV_VAR = "INTELIGIR_DATA_DIR";

export interface ResolvedServer {
  baseUrl: string;
  /** The bearer every request carries. Read from the data dir, never from the
   *  environment — a credential in an env var is inherited by every child. */
  token: string;
  /** Which instance answered, for `status` to print. */
  dataDir: string;
  /** What that instance is about to write into. */
  vaultDir: string;
}

export interface ResolveServerArgs {
  env: NodeJS.ProcessEnv;
  /** What the per-checkout dev-instance derivation hashes — the server's cwd. */
  checkoutPath: string;
  homeDir?: string;
}

/** The data dir this invocation means, by the app's own layering. */
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
