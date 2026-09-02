import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { authorizationHeader, readServerFile } from "inteligir/server/server-file";
import type { LocalContract } from "@repo/api/local";
import { HEALTH_PATH, healthResponseSchema, RPC_PREFIX } from "@repo/api/local/routes";
import { hermeticProcessEnv } from "./exec";
import { bootWithPorts, spawnSupervised, type TrackedProcess } from "./tracked-child";

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

function buildChildEnv(
  args: LaunchAppArgs,
  dataDir: string,
  vaultDir: string,
  port: number,
): NodeJS.ProcessEnv {
  for (const key of Object.keys(args.extraEnv ?? {})) {
    if (HARNESS_OWNED_ENV_KEYS.has(key) || key.startsWith("GIT_")) {
      throw new Error(
        `extraEnv must not set "${key}": the harness owns the instance paths, the port and git isolation`,
      );
    }
  }
  const env = hermeticProcessEnv();
  // the outer shell's own INTELIGIR_* must not leak into an instance.
  for (const key of Object.keys(env)) {
    if (key.startsWith("INTELIGIR_")) {
      delete env[key];
    }
  }
  // extraEnv merges first; the harness-owned keys below always win.
  Object.assign(env, args.extraEnv ?? {});
  env.INTELIGIR_DATA_DIR = dataDir;
  env.INTELIGIR_VAULT_DIR = vaultDir;
  env.INTELIGIR_PORT = String(port);
  if (args.vaultRemote !== undefined) {
    env.INTELIGIR_VAULT_REMOTE = args.vaultRemote;
  }
  return env;
}

interface LaunchCommand {
  file: string;
  argv: string[];
}

// the same bin a user's shell resolves; under a checkout it runs the source under tsx.
function resolveCommand(cliDir: string): LaunchCommand {
  const ui = join(cliDir, "dist", "ui", "index.html");
  if (!existsSync(ui)) {
    throw new Error(
      `the scenario suite needs the built workspace UI (missing ${ui}); run: pnpm --filter inteligir build`,
    );
  }
  return { file: join(cliDir, "bin", "inteligir"), argv: ["serve"] };
}

async function healthAnswered(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}${HEALTH_PATH}`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      return false;
    }
    // a proxy or a wrong process on the port can answer 200 with anything.
    const body: unknown = await response.json().catch(() => undefined);
    return healthResponseSchema.safeParse(body).success;
  } catch {
    return false;
  }
}

function attachInstance(
  args: LaunchAppArgs,
  child: TrackedProcess,
  dataDir: string,
  vaultDir: string,
  port: number,
): AppInstance {
  // read per call, not captured once: server.json is written after listen and this client is built
  // before the health wait.
  const link = new RPCLink({
    origin: `http://127.0.0.1:${String(port)}`,
    url: RPC_PREFIX,
    headers: () => {
      const server = readServerFile(dataDir);
      return server === null ? {} : { authorization: authorizationHeader(server.token) };
    },
  });
  return {
    ...child,
    api: createORPCClient(link),
    baseUrl: `http://127.0.0.1:${String(port)}`,
    dataDir,
    vaultDir,
    port,
  };
}

export async function launchApp(args: LaunchAppArgs): Promise<AppInstance> {
  // siblings: the app refuses a data dir inside the vault.
  const dataDir = join(args.instanceDir, "data");
  const vaultDir = join(args.instanceDir, "vault");
  await mkdir(dataDir, { recursive: true });

  const cliDir = join(args.repoRoot, "apps", "cli");
  const command = resolveCommand(cliDir);

  const instance = await bootWithPorts<AppInstance>({
    label: `instance "${args.name}"`,
    portCount: 1,
    deadlineMs: HEALTH_DEADLINE_MS,
    pollIntervalMs: HEALTH_POLL_INTERVAL_MS,
    onLog: args.onLog,
    spawn: (ports) => {
      const port = ports[0] ?? 0;
      const child = spawnSupervised({
        name: args.name,
        file: command.file,
        argv: command.argv,
        cwd: cliDir,
        env: buildChildEnv(args, dataDir, vaultDir, port),
      });
      const handle = attachInstance(args, child, dataDir, vaultDir, port);
      args.register(handle);
      args.onLog(`booting instance "${args.name}" on ${handle.baseUrl}`);
      return { handle, child };
    },
    ready: (handle) => healthAnswered(handle.baseUrl),
  });
  args.onLog(`instance "${args.name}" is healthy`);
  return instance;
}
