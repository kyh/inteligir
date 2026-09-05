import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SystemStatusResponse } from "@repo/api/local/system/system-schema";
import {
  resolveAppConfig,
  type ResolveAppConfigArgs,
  type VaultDirSource,
} from "inteligir/server/config";
import { resolveCheckoutRoot } from "inteligir/server/dev-instance";
import { toErrorMessage } from "../types";
import { createLocalClient } from "inteligir/server/local-client";
import { readServerFile } from "inteligir/server/server-file";

// never `localhost`: it resolves to ::1 or 127.0.0.1 per machine, and those are different origins to the pin.
export function serverOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

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

export function resolveServerTarget(args: ResolveServerTargetArgs): ServerTargetResult {
  try {
    // `isPackaged` decides the mode, never the ambient NODE_ENV: a checkout run as
    // production would drive the developer's real ~/.inteligir and ~/Inteligir.
    const env: NodeJS.ProcessEnv = {
      ...args.env,
      NODE_ENV: args.isPackaged ? "production" : "development",
    };
    if (args.vaultDir !== undefined) {
      env.INTELIGIR_VAULT_DIR = args.vaultDir;
    }
    const configArgs: ResolveAppConfigArgs = { checkoutPath: resolveCheckoutRoot(), env };
    if (args.homeDir !== undefined) {
      configArgs.homeDir = args.homeDir;
    }
    const config = resolveAppConfig(configArgs);
    return {
      kind: "resolved",
      target: {
        dataDir: config.dataDir,
        vaultDir: config.vaultDir,
        rootDataDir: config.rootDataDir,
        vaultDirSource: config.vaultDirSource,
        dataDirSource: config.dataDirSource,
      },
    };
  } catch (error) {
    return { kind: "refused", error: toErrorMessage(error) };
  }
}

// `origin` carries the bound port server.json names, not the configured one: a dev instance may have probed upward.
export interface LiveServer {
  origin: string;
  token: string;
}

export type ServerVerdict =
  | { kind: "verified"; live: LiveServer }
  | { kind: "no-server" }
  | { kind: "unreachable"; origin: string }
  | { kind: "wrong-data-dir"; origin: string; claimed: string };

const PROBE_TIMEOUT_MS = 2_000;

export type ProbeStatus = (server: LiveServer) => Promise<SystemStatusResponse | null>;

const probeStatusOverRpc: ProbeStatus = async (server) => {
  const client = createLocalClient({
    origin: server.origin,
    token: server.token,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  try {
    return await client.system.status();
  } catch {
    return null;
  }
};

// a loopback port is first-come-first-served, so a responder must answer this data dir's
// token and name the data dir back; reading the file proves this process can read the
// data dir, being answered proves the responder wrote it.
export async function verifyServer(
  dataDir: string,
  probeStatus: ProbeStatus = probeStatusOverRpc,
): Promise<ServerVerdict> {
  const file = readServerFile(dataDir);
  if (file === null) {
    return { kind: "no-server" };
  }
  const live: LiveServer = { origin: serverOrigin(file.port), token: file.token };
  const status = await probeStatus(live);
  if (status === null) {
    return { kind: "unreachable", origin: live.origin };
  }
  if (status.dataDir !== dataDir) {
    return { kind: "wrong-data-dir", origin: live.origin, claimed: status.dataDir };
  }
  return { kind: "verified", live };
}

export function describeServerVerdict(verdict: ServerVerdict, dataDir: string): string {
  switch (verdict.kind) {
    case "verified":
      return `${verdict.live.origin} serves ${dataDir}`;
    case "no-server":
      return `no inteligir server has published itself for ${dataDir}`;
    case "unreachable":
      return `${verdict.origin} did not answer this instance's token — the row in ${dataDir} is stale, or something else holds the port`;
    case "wrong-data-dir":
      return `${verdict.origin} serves a different data directory (${verdict.claimed})`;
  }
}

export type ServerPlan = "adopt" | "spawn";

export function planServerStart(verified: boolean): ServerPlan {
  return verified ? "adopt" : "spawn";
}

// no port: pinning one sets the child's `portSource` to `env`, which turns off its upward probe.
// NODE_ENV is stated because a Finder-launched app inherits none.
export function serverProcessEnv(target: ServerTarget, isPackaged: boolean) {
  return {
    INTELIGIR_DATA_DIR: target.dataDir,
    INTELIGIR_VAULT_DIR: target.vaultDir,
    NODE_ENV: isPackaged ? "production" : "development",
  };
}

// a process cannot be forked from inside an asar, so the path is rewritten to the `asarUnpack` twin.
export function serverPackageDir(appPath: string): string {
  const unpacked = appPath.replace(/app\.asar(?!\.unpacked)/u, "app.asar.unpacked");
  return join(unpacked, "node_modules", "inteligir");
}

// always the bundle: `utilityProcess` gives its child no loader thread, so `--import tsx` registers nothing there.
export function serverEntryPath(appPath: string): string {
  return join(serverPackageDir(appPath), "dist", "index.js");
}

// keyed by data dir: the app scheme is one origin whatever vault is behind it, so two vaults would share localStorage.
export function sessionPartition(dataDir: string): string {
  const digest = createHash("sha256").update(dataDir).digest("hex").slice(0, 16);
  return `persist:inteligir-${digest}`;
}
