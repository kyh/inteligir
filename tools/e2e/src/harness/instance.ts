import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { authorizationHeader, readServerFile } from "inteligir/server/server-file";
import type { LocalContract } from "@repo/api/local";
import { HEALTH_PATH, healthResponseSchema, RPC_PREFIX } from "@repo/api/local/routes";
import { hermeticProcessEnv } from "./exec";
import { bootWithPorts, spawnSupervised } from "./tracked-child";
import type { TrackedProcess } from "./tracked-child";

const HEALTH_POLL_INTERVAL_MS = 250;
const HEALTH_DEADLINE_MS = 60_000;

export interface LaunchAppArgs {
  name: string;
  instanceDir: string;
  repoRoot: string;
  vaultRemote?: string;
  extraEnv?: Readonly<Record<string, string>>;
  onLog: (line: string) => void;
  register: (instance: AppInstance) => void;
}

export type InstanceApi = ContractRouterClient<LocalContract>;

export interface AppInstance extends TrackedProcess {
  api: InstanceApi;
  baseUrl: string;
  dataDir: string;
  vaultDir: string;
  port: number;
}

const HARNESS_OWNED_ENV_KEYS = new Set([
  "INTELIGIR_DATA_DIR",
  "INTELIGIR_VAULT_DIR",
  "INTELIGIR_PORT",
  "INTELIGIR_VAULT_REMOTE",
]);

const buildChildEnv = (
  args: LaunchAppArgs,
  dataDir: string,
  vaultDir: string,
  port: number,
): NodeJS.ProcessEnv => {
  for (const key of Object.keys(args.extraEnv ?? {})) {
    if (HARNESS_OWNED_ENV_KEYS.has(key) || key.startsWith("GIT_")) {
      throw new Error(
        `extraEnv must not set "${key}": the harness owns the instance paths, the port and git isolation`,
      );
    }
  }
  // the outer shell's own INTELIGIR_* must not leak into an instance.
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(hermeticProcessEnv()).filter(([key]) => !key.startsWith("INTELIGIR_")),
  );
  // extraEnv merges first; the harness-owned keys below always win.
  Object.assign(env, args.extraEnv ?? {});
  env.INTELIGIR_DATA_DIR = dataDir;
  env.INTELIGIR_VAULT_DIR = vaultDir;
  env.INTELIGIR_PORT = String(port);
  if (args.vaultRemote !== undefined) {
    env.INTELIGIR_VAULT_REMOTE = args.vaultRemote;
  }
  return env;
};

interface LaunchCommand {
  file: string;
  argv: string[];
}

// the same bin a user's shell resolves; under a checkout it runs the source under tsx.
const resolveCommand = (cliDir: string): LaunchCommand => {
  const ui = path.join(cliDir, "dist", "ui", "index.html");
  if (!existsSync(ui)) {
    throw new Error(
      `the scenario suite needs the built workspace UI (missing ${ui}); run: pnpm --filter inteligir build`,
    );
  }
  return { argv: ["serve"], file: path.join(cliDir, "bin", "inteligir") };
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

const attachInstance = (
  args: LaunchAppArgs,
  child: TrackedProcess,
  dataDir: string,
  vaultDir: string,
  port: number,
): AppInstance => {
  // read per call, not captured once: server.json is written after listen and this client is built
  // before the health wait.
  const link = new RPCLink({
    headers: () => {
      const server = readServerFile(dataDir);
      return server === null ? {} : { authorization: authorizationHeader(server.token) };
    },
    origin: `http://127.0.0.1:${String(port)}`,
    url: RPC_PREFIX,
  });
  return {
    ...child,
    api: createORPCClient(link),
    baseUrl: `http://127.0.0.1:${String(port)}`,
    dataDir,
    port,
    vaultDir,
  };
};

export const launchApp = async (args: LaunchAppArgs): Promise<AppInstance> => {
  // siblings: the app refuses a data dir inside the vault.
  const dataDir = path.join(args.instanceDir, "data");
  const vaultDir = path.join(args.instanceDir, "vault");
  await mkdir(dataDir, { recursive: true });

  const cliDir = path.join(args.repoRoot, "apps", "cli");
  const command = resolveCommand(cliDir);

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
        env: buildChildEnv(args, dataDir, vaultDir, port),
        file: command.file,
        name: args.name,
      });
      const handle = attachInstance(args, child, dataDir, vaultDir, port);
      args.register(handle);
      args.onLog(`booting instance "${args.name}" on ${handle.baseUrl}`);
      return { child, handle };
    },
  });
  args.onLog(`instance "${args.name}" is healthy`);
  return instance;
};
