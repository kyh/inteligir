// Boots ONE real server on a scratch instance dir (data/ and vault/ as
// siblings — the app refuses nesting) and hands back the typed client.
//
// ONE MODE, because there is one build: the workspace is a plain SPA built
// once and served as files, so the suite drives the same bytes and the same
// policy a user gets. A dev entry that mounted Vite in the server process
// would serve different code and force a second run.
//
// The child-process half — the group, the kill ladder, the output ring, the
// port-retry boot loop — is `tracked-child.ts`, shared with the cloud Worker.

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
  /** Short label for transcript lines ("a", "b", "solo"). */
  name: string;
  /** Scratch dir owned by this instance; data/ and vault/ are created inside. */
  instanceDir: string;
  repoRoot: string;
  /** Git remote URL for the vault sync loop; omitted = local-only. */
  vaultRemote?: string;
  /** Extra child env (e.g. the scripted-agent contract). Harness-owned keys
   *  (the paths, the port, NODE_ENV, anything GIT_*) are refused. */
  extraEnv?: Readonly<Record<string, string>>;
  onLog: (line: string) => void;
  /** Called as soon as the process exists — BEFORE the health wait — so the
   *  caller's teardown owns the group through every early-exit path. */
  register: (instance: AppInstance) => void;
}

/** The typed client every scenario drives. A refusal THROWS, so a scenario
 *  that forgot to check one fails rather than asserting on a refusal body. */
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
  // The outer shell's own INTELIGIR_* must never leak into an instance.
  for (const key of Object.keys(env)) {
    if (key.startsWith("INTELIGIR_")) {
      delete env[key];
    }
  }
  // extraEnv merges FIRST; the harness-owned keys below always win.
  Object.assign(env, args.extraEnv ?? {});
  env.INTELIGIR_DATA_DIR = dataDir;
  env.INTELIGIR_VAULT_DIR = vaultDir;
  env.INTELIGIR_PORT = String(port);
  if (args.vaultRemote !== undefined) {
    env.INTELIGIR_VAULT_REMOTE = args.vaultRemote;
  }
  return env;
}

/** The executable and argv every instance spawns. */
interface LaunchCommand {
  file: string;
  argv: string[];
}

/**
 * `inteligir serve` through its own bin — the same entry a user's shell
 * resolves, which under a checkout runs the SOURCE under tsx.
 *
 * The built workspace UI is required rather than optional: the browser
 * scenarios drive the real page, and a server with no UI would answer their
 * navigation with a 404 no assertion could explain.
 */
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
    // The body shape, not just a 2xx: a proxy or a wrong process on the port
    // can answer 200 with anything.
    const body: unknown = await response.json().catch(() => undefined);
    return healthResponseSchema.safeParse(body).success;
  } catch {
    return false;
  }
}

/** The instance client over a spawned child — everything about an app
 *  instance that is not the child process itself. */
function attachInstance(
  args: LaunchAppArgs,
  child: TrackedProcess,
  dataDir: string,
  vaultDir: string,
  port: number,
): AppInstance {
  // The device token is read from the instance's own data dir on every call
  // rather than captured once: it is published after listen, and this client is
  // built before the health wait.
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
      // Registered at SPAWN, before the health wait, so the runner's teardown
      // owns the group through every early-exit path.
      args.register(handle);
      args.onLog(`booting instance "${args.name}" on ${handle.baseUrl}`);
      return { handle, child };
    },
    ready: (handle) => healthAnswered(handle.baseUrl),
  });
  args.onLog(`instance "${args.name}" is healthy`);
  return instance;
}
