import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { browserHandoffUrl } from "@repo/api/local/routes";
import { resolveAppConfig } from "inteligir/server/config";
import type { ResolveAppConfigArgs, VaultDirSource } from "inteligir/server/config";
import { resolveCheckoutRoot } from "inteligir/server/dev-instance";
import { resolveVaultCandidate } from "inteligir/server/vault-switch";
import { toErrorMessage } from "../types";
import { createLocalClient } from "inteligir/server/local-client";
import { probeServerFile, silentOwnerSentence } from "inteligir/server/server-probe";
import type { AskServerStatus } from "inteligir/server/server-probe";

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

export const resolveServerTarget = (args: ResolveServerTargetArgs): ServerTargetResult => {
  try {
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
    const config =
      args.vaultDir === undefined
        ? resolveAppConfig(configArgs)
        : resolveVaultCandidate(configArgs, args.vaultDir);
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
    return { error: toErrorMessage(error), kind: "refused" };
  }
};

// `origin` carries the bound port server.json names, not the configured one: a dev instance may have probed upward.
export interface LiveServer {
  origin: string;
  token: string;
}

export type ServerVerdict =
  | { kind: "verified"; live: LiveServer }
  | { kind: "no-server" }
  | { kind: "stale"; pid: number }
  | { kind: "unreachable"; origin: string }
  | { kind: "silent"; pid: number; port: number }
  | { kind: "unreadable"; origin: string }
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
  switch (probe.kind) {
    case "none": {
      return { kind: "no-server" };
    }
    case "dead-owner": {
      return { kind: "stale", pid: probe.row.pid };
    }
    case "silent": {
      return { kind: "silent", pid: probe.row.pid, port: probe.row.port };
    }
    case "refused": {
      return { kind: "unreachable", origin: probe.origin };
    }
    case "unreadable": {
      return { kind: "unreadable", origin: probe.origin };
    }
    case "answered": {
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
    }
    default: {
      const exhaustive: never = probe;
      return exhaustive;
    }
  }
};

const HANDOFF_TIMEOUT_MS = 2000;

// a browser holds no bearer, so it signs in once through a single-use handoff the server mints.
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
    case "no-server": {
      return `no inteligir server has published itself for ${dataDir}`;
    }
    case "stale": {
      return `the server that published itself for ${dataDir} (pid ${String(verdict.pid)}) has exited`;
    }
    case "unreachable": {
      return `${verdict.origin} did not answer this instance's token — the row in ${dataDir} is stale, or something else holds the port`;
    }
    case "silent": {
      return silentOwnerSentence(dataDir, verdict);
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
    case "no-server":
    case "stale":
    case "unreachable":
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

// no port: pinning one sets the child's `portSource` to `env`, which turns off its upward probe.
// NODE_ENV is stated because a Finder-launched app inherits none.
export const serverProcessEnv = (target: ServerTarget, isPackaged: boolean) => ({
  INTELIGIR_DATA_DIR: target.dataDir,
  INTELIGIR_VAULT_DIR: target.vaultDir,
  NODE_ENV: isPackaged ? "production" : "development",
});

// a process cannot be forked from inside an asar, so the path is rewritten to the `asarUnpack` twin.
export const serverPackageDir = (appPath: string): string => {
  const unpacked = appPath.replace(/app\.asar(?!\.unpacked)/u, "app.asar.unpacked");
  return path.join(unpacked, "node_modules", "inteligir");
};

// always the bundle: `utilityProcess` gives its child no loader thread, so `--import tsx` registers nothing there.
export const serverEntryPath = (appPath: string): string =>
  path.join(serverPackageDir(appPath), "dist", "index.js");

const serverManifestSchema = z.looseObject({ version: z.string().min(1) });

// the version the forked child reports as its status, since it reads this same manifest.
export const bundledServerVersion = (appPath: string): string => {
  const manifestPath = path.join(serverPackageDir(appPath), "package.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (error) {
    throw new Error(
      `the bundled server's manifest is unreadable (${manifestPath}) — this install is incomplete`,
      {
        cause: error,
      },
    );
  }
  const parsed = serverManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new Error(`the bundled server's manifest names no version (${manifestPath})`);
  }
  return parsed.data.version;
};

// keyed by data dir: the app scheme is one origin whatever vault is behind it, so two vaults would share localStorage.
export const sessionPartition = (dataDir: string): string => {
  const digest = createHash("sha256").update(dataDir).digest("hex").slice(0, 16);
  return `persist:inteligir-${digest}`;
};
