// Which vault the desktop's server is bound to, and whether the one already listening for it may be
// adopted. The resolution is the server's own, so the shell and `inteligir serve` can never boot
// two answers to "which vault".

import { browserHandoffUrl } from "@repo/contract/local/routes";
import { resolveAppConfig } from "../server/config";
import type { AppConfig, ResolveAppConfigArgs, VaultDirSource } from "../server/config";
import { resolveCheckoutRoot } from "../server/dev-instance";
import { messageOf } from "../server/error-message";
import { createLocalClient } from "../server/local-client";
import { probeServerFile, silentOwnerSentence } from "../server/server-probe";
import type { AskServerStatus, ServerFileProbe } from "../server/server-probe";
import { resolveVaultCandidate } from "../server/vault-switch";
import type { InspectVaultFolderContext } from "../server/vault/folder-facts";

export interface ServerTarget {
  dataDir: string;
  vaultDir: string;
  // where config.json lives; the data dir of any vault but the default sits beneath it
  rootDataDir: string;
  // env-pinned values are not the shell's to change, so a switch is refused while either is
  vaultDirSource: VaultDirSource;
  dataDirSource: "env" | "default";
}

export type ServerTargetResult =
  | { kind: "resolved"; target: ServerTarget }
  | { kind: "refused"; error: string };

export interface ResolveServerTargetArgs {
  isPackaged: boolean;
  env: NodeJS.ProcessEnv;
  homeDir?: string;
  // a candidate for a switch: resolved and refused exactly as a boot would, before anything moves
  vaultDir?: string;
}

const resolveConfigFor = (args: ResolveServerTargetArgs): AppConfig => {
  // `isPackaged` decides the mode, never the ambient NODE_ENV: a checkout run as
  // production would drive the developer's real ~/.inteligir and ~/Inteligir.
  const env: NodeJS.ProcessEnv = {
    ...args.env,
    NODE_ENV: args.isPackaged ? "production" : "development",
  };
  const configArgs: ResolveAppConfigArgs = { checkoutPath: resolveCheckoutRoot(), env };
  if (args.homeDir !== undefined) {
    configArgs.homeDir = args.homeDir;
  }
  return args.vaultDir === undefined
    ? resolveAppConfig(configArgs)
    : resolveVaultCandidate(configArgs, args.vaultDir);
};

// what a folder is judged against before it is a vault: the home the outside-sync roots hang from,
// and the cloud whose hosted url is the app's own origin rather than one the folder brought. git is
// the one the shell's environment names, which the entry runs under
export const folderFactsContext = (args: ResolveServerTargetArgs): InspectVaultFolderContext => {
  const { cloudUrl, homeDir } = resolveConfigFor(args);
  return { cloudUrl, homeDir };
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

// `origin` carries the bound port server.json names, not the configured one: a dev instance may have probed upward.
export interface LiveServer {
  origin: string;
  token: string;
}

export type ServerVerdict =
  | Exclude<ServerFileProbe, { kind: "answered" }>
  | { kind: "verified"; live: LiveServer }
  | { kind: "wrong-data-dir"; origin: string; claimed: string }
  | { kind: "incompatible"; origin: string; serverVersion: string; expected: string };

// a loopback port is first-come-first-served, so a responder must answer this data dir's
// token and name the data dir back; reading the file proves this process can read the
// data dir, being answered proves the responder wrote it. the version must match too: the
// window and the server speak /local, whose two ends may break freely because they ship together.
export const verifyServer = async (
  dataDir: string,
  expectedVersion: string,
  askStatus?: AskServerStatus,
): Promise<ServerVerdict> => {
  const probe = await probeServerFile(dataDir, askStatus);
  if (probe.kind !== "answered") {
    return probe;
  }
  const { identity, origin, row } = probe;
  if (identity.dataDir !== dataDir) {
    return { claimed: identity.dataDir, kind: "wrong-data-dir", origin };
  }
  if (identity.version !== expectedVersion) {
    return {
      expected: expectedVersion,
      kind: "incompatible",
      origin,
      serverVersion: identity.version,
    };
  }
  return { kind: "verified", live: { origin, token: row.token } };
};

const HANDOFF_TIMEOUT_MS = 2000;

// a page holds no bearer, so a window and a browser each sign in once through a single-use
// handoff the server mints.
export const browserSignInUrl = async (server: LiveServer): Promise<string> => {
  const client = createLocalClient({
    origin: server.origin,
    timeoutMs: HANDOFF_TIMEOUT_MS,
    token: server.token,
  });
  const { nonce } = await client.system.browserHandoff();
  return browserHandoffUrl(`${server.origin}/`, nonce);
};

export const describeServerVerdict = (verdict: ServerVerdict, dataDir: string): string => {
  switch (verdict.kind) {
    case "verified": {
      return `${verdict.live.origin} serves ${dataDir}`;
    }
    case "none": {
      return `no inteligir server has published itself for ${dataDir}`;
    }
    case "dead-owner": {
      return `the server that published itself for ${dataDir} (pid ${String(verdict.row.pid)}) has exited`;
    }
    case "refused": {
      return `${verdict.origin} did not answer this instance's token — the row in ${dataDir} is stale, or something else holds the port`;
    }
    case "silent": {
      return silentOwnerSentence(dataDir, verdict.row);
    }
    case "unreadable": {
      return `${verdict.origin} answered with something that is not an inteligir server's status`;
    }
    case "wrong-data-dir": {
      return `${verdict.origin} serves a different data directory (${verdict.claimed})`;
    }
    case "incompatible": {
      return `An inteligir ${verdict.serverVersion} server already serves ${dataDir} at ${verdict.origin}, and this app runs ${verdict.expected}. Stop that server, then try again.`;
    }
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
};

export type ServerPlan =
  | { kind: "adopt"; live: LiveServer }
  | { kind: "spawn" }
  // it holds the data dir but cannot be adopted, and a child spawned over it would lose to its lock.
  | { kind: "refuse"; reason: string };

export const planServerStart = (verdict: ServerVerdict, dataDir: string): ServerPlan => {
  switch (verdict.kind) {
    case "verified": {
      return { kind: "adopt", live: verdict.live };
    }
    case "silent":
    case "incompatible": {
      return { kind: "refuse", reason: describeServerVerdict(verdict, dataDir) };
    }
    case "none":
    case "dead-owner":
    case "refused":
    case "unreadable":
    case "wrong-data-dir": {
      return { kind: "spawn" };
    }
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
};
