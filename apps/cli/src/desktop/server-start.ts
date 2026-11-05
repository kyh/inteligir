// Which vault a server the browsers' door starts is bound to. The resolution is the server's own,
// so the door and `inteligir serve` can never boot two answers to "which vault".

import { resolveAppConfig } from "../server/config";
import type { AppConfig, ResolveAppConfigArgs, VaultDirSource } from "../server/config";
import { resolveCheckoutRoot } from "../server/dev-instance";
import { messageOf } from "../server/error-message";

export interface ServerTarget {
  dataDir: string;
  vaultDir: string;
  // where config.json lives; every vault's data dir sits beneath it
  rootDataDir: string;
  vaultDirSource: VaultDirSource;
  dataDirSource: "env" | "default";
}

export type ServerTargetResult =
  | { kind: "resolved"; target: ServerTarget }
  | { kind: "refused"; error: string };

export interface ResolveServerTargetArgs {
  // its NODE_ENV is the mode
  env: NodeJS.ProcessEnv;
  homeDir?: string;
}

const resolveConfigFor = (args: ResolveServerTargetArgs): AppConfig => {
  const configArgs: ResolveAppConfigArgs = { checkoutPath: resolveCheckoutRoot(), env: args.env };
  if (args.homeDir !== undefined) {
    configArgs.homeDir = args.homeDir;
  }
  return resolveAppConfig(configArgs);
};

export const resolveServerTarget = (args: ResolveServerTargetArgs): ServerTargetResult => {
  try {
    const config = resolveConfigFor(args);
    return {
      kind: "resolved",
      target: {
        dataDir: config.dataDir,
        dataDirSource: config.dataDirSource,
        rootDataDir: config.rootDataDir,
        vaultDir: config.vaultDir,
        vaultDirSource: config.vaultDirSource,
      },
    };
  } catch (error) {
    return { error: messageOf(error), kind: "refused" };
  }
};
