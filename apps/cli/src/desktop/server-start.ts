// Which data dir the desktop's server serves, and whether the one already listening for it may be
// adopted. The resolution is the server's own, so the shell and `inteligir serve` can never boot
// two answers to "which data dir".

import { isDefinedError, safe } from "@orpc/client";
import { browserHandoffUrl } from "@repo/contract/local/routes";
import { resolveAppConfig } from "../server/config";
import type { AppConfig, ResolveAppConfigArgs } from "../server/config";
import { resolveCheckoutRoot } from "../server/dev-instance";
import { messageOf } from "../server/error-message";
import { createLocalClient } from "../server/local-client";
import { probeServerFile, silentOwnerSentence } from "../server/server-probe";
import type { AskServerStatus, ServerFileProbe } from "../server/server-probe";

interface ServerTarget {
  dataDir: string;
  dataDirSource: "env" | "default";
}

export type ServerTargetResult =
  | { kind: "resolved"; target: ServerTarget }
  | { kind: "refused"; error: string };

export interface ResolveServerTargetArgs {
  isPackaged: boolean;
  env: NodeJS.ProcessEnv;
  homeDir?: string;
}

const resolveConfigFor = (args: ResolveServerTargetArgs): AppConfig => {
  // `isPackaged` decides the mode, never the ambient NODE_ENV: a checkout run as
  // production would drive the developer's real ~/.inteligir.
  const env: NodeJS.ProcessEnv = {
    ...args.env,
    NODE_ENV: args.isPackaged ? "production" : "development",
  };
  const configArgs: ResolveAppConfigArgs = { checkoutPath: resolveCheckoutRoot(), env };
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
      target: { dataDir: config.dataDir, dataDirSource: config.dataDirSource },
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

export type Adoption =
  | { kind: "adopted"; handoffUrl: string }
  | { kind: "refused"; reason: string };

// a server built without its page (an unbuilt checkout) cannot sign a window in, so it is refused
// in words: thrown, it would end the entry with nothing the shell could show
export const adoptServer = async (live: LiveServer, dataDir: string): Promise<Adoption> => {
  const client = createLocalClient({
    origin: live.origin,
    timeoutMs: HANDOFF_TIMEOUT_MS,
    token: live.token,
  });
  const handoff = await safe(client.system.browserHandoff());
  if (handoff.error === null) {
    return {
      handoffUrl: browserHandoffUrl(`${live.origin}/`, handoff.data.nonce),
      kind: "adopted",
    };
  }
  if (isDefinedError(handoff.error) && handoff.error.code === "NOT_FOUND") {
    return {
      kind: "refused",
      reason: `The inteligir server already serving ${dataDir} at ${live.origin} was built without its app, so it has no window to show. Stop that server, then try again.`,
    };
  }
  throw handoff.error;
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
