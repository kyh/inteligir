import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { authorizationHeader, loopbackOrigin, readServerFile } from "inteligir/server/server-file";
import type { LocalContract } from "@repo/api/local";
import {
  browserHandoffUrl,
  HEALTH_PATH,
  healthResponseSchema,
  RPC_PREFIX,
} from "@repo/api/local/routes";
import { appLaunchEnv } from "./exec";
import { bootWithPorts, spawnSupervised } from "./tracked-child";
import type { TrackedProcess } from "./tracked-child";

const HEALTH_POLL_INTERVAL_MS = 250;
const HEALTH_DEADLINE_MS = 60_000;

// source: the bin a user's shell resolves, which in a checkout runs src/ under tsx. built: the
// bundle a published install and the desktop shell run.
export type LaunchMode = "source" | "built";

export interface LaunchAppArgs {
  name: string;
  instanceDir: string;
  repoRoot: string;
  mode: LaunchMode;
  vaultRemote?: string;
  extraEnv?: Readonly<Record<string, string>>;
  onLog: (line: string) => void;
  register: (instance: AppInstance) => void;
}

export type InstanceApi = ContractRouterClient<LocalContract>;

export interface AppInstance extends TrackedProcess {
  api: InstanceApi;
  baseUrl: string;
  // a browser holds no bearer: each open signs it in through a fresh single-use handoff.
  browserUrl: (pathAndSearch: string) => Promise<string>;
  dataDir: string;
  vaultDir: string;
  // the vendors' stores this instance runs them over, empty until something writes them.
  vendorDirs: VendorDirs;
  port: number;
}

// the vendors' stores are the instance's own, empty: an instance never runs the agent, or asks
// its sign-in, on whatever account the machine running the suite is signed into.
const HARNESS_OWNED_ENV_KEYS = new Set([
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "INTELIGIR_DATA_DIR",
  "INTELIGIR_VAULT_DIR",
  "INTELIGIR_PORT",
  "INTELIGIR_VAULT_REMOTE",
  "NODE_ENV",
]);

interface VendorDirs {
  claudeConfigDir: string;
  codexHome: string;
}

interface InstanceDirs extends VendorDirs {
  dataDir: string;
  vaultDir: string;
}

interface LaunchCommand {
  file: string;
  argv: string[];
  env: Readonly<Record<string, string>>;
}

const buildChildEnv = (
  args: LaunchAppArgs,
  command: LaunchCommand,
  dirs: InstanceDirs,
  port: number,
): NodeJS.ProcessEnv => {
  for (const key of Object.keys(args.extraEnv ?? {})) {
    if (HARNESS_OWNED_ENV_KEYS.has(key) || key.startsWith("GIT_")) {
      throw new Error(
        `extraEnv must not set "${key}": the harness owns the instance paths, the vendors' stores, the port, the runtime mode and git isolation`,
      );
    }
  }
  const env = appLaunchEnv();
  // extraEnv merges first; the harness-owned keys below always win.
  Object.assign(env, args.extraEnv ?? {}, command.env);
  env.CLAUDE_CONFIG_DIR = dirs.claudeConfigDir;
  env.CODEX_HOME = dirs.codexHome;
  env.INTELIGIR_DATA_DIR = dirs.dataDir;
  env.INTELIGIR_VAULT_DIR = dirs.vaultDir;
  env.INTELIGIR_PORT = String(port);
  if (args.vaultRemote !== undefined) {
    env.INTELIGIR_VAULT_REMOTE = args.vaultRemote;
  }
  return env;
};

// a backstop: the runner builds these at suite start, so a miss means that build did not stage them.
const requireBuilt = (file: string): void => {
  if (!existsSync(file)) {
    throw new Error(
      `the scenario suite needs ${file}, which the runner's suite-start build stages`,
    );
  }
};

// both modes serve dist/ui: a server with no workspace UI answers the API and 404s the browser.
// built runs the bundle directly, as the bin does for a published install, because in a checkout
// the bin always picks the source.
const resolveCommand = (cliDir: string, mode: LaunchMode): LaunchCommand => {
  requireBuilt(path.join(cliDir, "dist", "ui", "index.html"));
  if (mode === "source") {
    return { argv: ["serve"], env: {}, file: path.join(cliDir, "bin", "inteligir") };
  }
  const entry = path.join(cliDir, "dist", "index.js");
  requireBuilt(entry);
  return { argv: [entry, "serve"], env: { NODE_ENV: "production" }, file: process.execPath };
};

const healthAnswered = async (baseUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(`${baseUrl}${HEALTH_PATH}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      return false;
    }
    // a proxy or a wrong process on the port can answer 200 with anything.
    const body: unknown = await response.json().catch(() => {
      /* empty */
    });
    return healthResponseSchema.safeParse(body).success;
  } catch {
    return false;
  }
};

// the bearer is read per call, not captured once: server.json is written after listen, a client
// may be built before the health wait, and a restarted server mints a new token.
export const createInstanceApi = (baseUrl: string, dataDir: () => string): InstanceApi => {
  const link = new RPCLink({
    headers: () => {
      const server = readServerFile(dataDir());
      return server === null ? {} : { authorization: authorizationHeader(server.token) };
    },
    origin: baseUrl,
    url: RPC_PREFIX,
  });
  return createORPCClient(link);
};

const attachInstance = (child: TrackedProcess, dirs: InstanceDirs, port: number): AppInstance => {
  const { claudeConfigDir, codexHome, dataDir, vaultDir } = dirs;
  const baseUrl = loopbackOrigin(port);
  const api = createInstanceApi(baseUrl, () => dataDir);
  return {
    ...child,
    api,
    baseUrl,
    browserUrl: async (pathAndSearch) => {
      const { nonce } = await api.system.browserHandoff();
      return browserHandoffUrl(`${baseUrl}${pathAndSearch}`, nonce);
    },
    dataDir,
    port,
    vaultDir,
    vendorDirs: { claudeConfigDir, codexHome },
  };
};

export const launchApp = async (args: LaunchAppArgs): Promise<AppInstance> => {
  // siblings: the app refuses a data dir inside the vault.
  const dataDir = path.join(args.instanceDir, "data");
  const vaultDir = path.join(args.instanceDir, "vault");
  const dirs: InstanceDirs = {
    claudeConfigDir: path.join(args.instanceDir, "claude-config"),
    codexHome: path.join(args.instanceDir, "codex-home"),
    dataDir,
    vaultDir,
  };
  await mkdir(dataDir, { recursive: true });
  await mkdir(dirs.claudeConfigDir, { recursive: true });
  await mkdir(dirs.codexHome, { recursive: true });

  const cliDir = path.join(args.repoRoot, "apps", "cli");
  const command = resolveCommand(cliDir, args.mode);

  const instance = await bootWithPorts<AppInstance>({
    deadlineMs: HEALTH_DEADLINE_MS,
    label: `instance "${args.name}"`,
    onLog: args.onLog,
    pollIntervalMs: HEALTH_POLL_INTERVAL_MS,
    portCount: 1,
    ready: async (handle) => await healthAnswered(handle.baseUrl),
    spawn: (ports) => {
      const port = ports[0] ?? 0;
      const child = spawnSupervised({
        argv: command.argv,
        cwd: cliDir,
        env: buildChildEnv(args, command, dirs, port),
        file: command.file,
        name: args.name,
      });
      const handle = attachInstance(child, dirs, port);
      args.register(handle);
      args.onLog(`booting ${args.mode} instance "${args.name}" on ${handle.baseUrl}`);
      return { child, handle };
    },
  });
  args.onLog(`instance "${args.name}" is healthy`);
  return instance;
};
