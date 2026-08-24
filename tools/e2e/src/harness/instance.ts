// Boots ONE real app process on a scratch instance dir (data/ and vault/ as
// siblings — the app refuses nesting) and hands back the typed API client.
// Dev mode runs the same entry `pnpm dev` runs (tsx + vite middleware); prod
// mode runs the built bundle (`dist-node/main.js`) under plain node.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { authorizationHeader, readServerFile } from "@repo/app/node/server-file";
import type { LocalContract } from "@repo/api/local";
import { HEALTH_PATH, healthResponseSchema, RPC_PREFIX } from "@repo/api/local/routes";
import { hermeticProcessEnv } from "./exec";
import { reserveFreePorts } from "./ports";

export type BootMode = "dev" | "prod";

const HEALTH_POLL_INTERVAL_MS = 250;
/** Dev pays a vite cold start; prod is a plain node boot. */
const HEALTH_DEADLINE_MS = { dev: 120_000, prod: 30_000 } satisfies Record<BootMode, number>;
const STOP_SIGTERM_GRACE_MS = 5_000;
const STOP_SIGKILL_GRACE_MS = 2_000;
const KILL_POLL_INTERVAL_MS = 100;
/** Bound on losing the reserve→bind race to another process on the machine. */
const BOOT_PORT_ATTEMPTS = 3;

/**
 * Every process group the harness has spawned and not yet verified dead —
 * module scope on purpose: this is a single-process CLI, and the runner's
 * signal handlers need one place that names every group to kill.
 */
const liveGroups = new Set<number>();

/** For the runner's SIGINT/SIGTERM handlers; synchronous, best-effort. */
export function killAllLiveGroups(signal: NodeJS.Signals): void {
  for (const pgid of liveGroups) {
    try {
      process.kill(-pgid, signal);
    } catch {
      // Group already gone.
    }
  }
}

export interface LaunchAppArgs {
  mode: BootMode;
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

export interface AppInstance {
  api: InstanceApi;
  baseUrl: string;
  dataDir: string;
  vaultDir: string;
  port: number;
  name: string;
  /** The child's interleaved stdout+stderr tail, for failure transcripts. */
  outputTail(lines?: number): string;
  /** Resolves once the WHOLE process group is verified gone (ESRCH); throws
   *  if the group survives SIGKILL — the caller must then keep the scratch. */
  stop(): Promise<void>;
}

const HARNESS_OWNED_ENV_KEYS = new Set([
  "INTELIGIR_DATA_DIR",
  "INTELIGIR_VAULT_DIR",
  "INTELIGIR_PORT",
  "INTELIGIR_VAULT_REMOTE",
  "INTELIGIR_HMR_PORT",
  "NODE_ENV",
]);

function buildChildEnv(
  args: LaunchAppArgs,
  dataDir: string,
  vaultDir: string,
  port: number,
  hmrPort: number | undefined,
): NodeJS.ProcessEnv {
  for (const key of Object.keys(args.extraEnv ?? {})) {
    if (HARNESS_OWNED_ENV_KEYS.has(key) || key.startsWith("GIT_")) {
      throw new Error(
        `extraEnv must not set "${key}": the harness owns the instance paths, the port, the mode and git isolation`,
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
  if (args.mode === "prod") {
    env.NODE_ENV = "production";
  } else {
    delete env.NODE_ENV;
    // Vite's default HMR websocket port is machine-global; concurrent
    // instances (and any other vite dev server on the box) collide on it and
    // the loser's page throws. Each instance gets its own reserved port.
    if (hmrPort !== undefined) {
      env.INTELIGIR_HMR_PORT = String(hmrPort);
    }
  }
  return env;
}

/** The executable and argv one boot mode spawns. */
interface LaunchCommand {
  file: string;
  argv: string[];
}

function resolveCommand(mode: BootMode, appDir: string): LaunchCommand {
  if (mode === "dev") {
    return {
      file: join(appDir, "node_modules", ".bin", "tsx"),
      argv: [join(appDir, "src", "node", "main.ts")],
    };
  }
  const bundle = join(appDir, "dist-node", "main.js");
  // The Start server entry, because it is what answers every HTML navigation
  // in prod — a dist-node bundle beside a missing entry boots and then 500s
  // the page, which is a worse failure than refusing here.
  const startEntry = join(appDir, "dist", "server", "server.js");
  const missing = [bundle, startEntry].find((artifact) => !existsSync(artifact));
  if (missing !== undefined) {
    throw new Error(
      `prod mode needs the built app (missing ${missing}); run: pnpm --filter @repo/app build`,
    );
  }
  return { file: process.execPath, argv: [bundle] };
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pollGroupGone(pgid: number, graceMs: number): Promise<boolean> {
  const deadline = Date.now() + graceMs;
  for (;;) {
    if (!groupAlive(pgid)) {
      return true;
    }
    if (Date.now() > deadline) {
      return false;
    }
    await delay(KILL_POLL_INTERVAL_MS);
  }
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

type AttemptResult =
  /** The reserved port was taken between reserve and bind; retry fresh. */
  { kind: "port-lost"; tail: string } | { kind: "ready"; instance: AppInstance };

/** A spawned child, paired with the liveness flag its exit handlers set. */
interface SpawnedAttempt {
  instance: AppInstance;
  exited: () => boolean;
}

function spawnAttempt(
  args: LaunchAppArgs,
  command: LaunchCommand,
  appDir: string,
  dataDir: string,
  vaultDir: string,
  port: number,
  hmrPort: number | undefined,
): SpawnedAttempt {
  const baseUrl = `http://127.0.0.1:${port}`;

  // Its own process group, so stop() can kill the whole tree — the dev entry
  // forks a watcher child that would otherwise outlive its parent.
  const child = spawn(command.file, command.argv, {
    cwd: appDir,
    detached: true,
    env: buildChildEnv(args, dataDir, vaultDir, port, hmrPort),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pid = child.pid;
  if (pid !== undefined) {
    liveGroups.add(pid);
  }

  const outputLines: string[] = [];
  function consume(stream: NodeJS.ReadableStream, label: string): void {
    let buffered = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length > 0) {
          outputLines.push(`[${label}] ${line}`);
        }
      }
    });
  }
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (stdout !== null) {
    consume(stdout, args.name);
  }
  if (stderr !== null) {
    consume(stderr, `${args.name}!`);
  }

  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  child.once("error", (error) => {
    outputLines.push(`[${args.name}!] spawn error: ${error.message}`);
    exited = true;
  });

  function outputTail(lines = 40): string {
    return outputLines.slice(-lines).join("\n");
  }

  let stopPromise: Promise<void> | null = null;
  function stop(): Promise<void> {
    stopPromise ??= (async () => {
      if (pid === undefined) {
        return;
      }
      try {
        // The GROUP, leader dead or not — the watcher child outlives a
        // crashed leader. (A recycled pgid is theoretically reachable here;
        // the window between leader exit and this signal is too small to
        // matter on a test box.)
        process.kill(-pid, "SIGTERM");
      } catch {
        // Whole group already gone.
      }
      if (await pollGroupGone(pid, STOP_SIGTERM_GRACE_MS)) {
        liveGroups.delete(pid);
        return;
      }
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Gone between polls.
      }
      if (await pollGroupGone(pid, STOP_SIGKILL_GRACE_MS)) {
        liveGroups.delete(pid);
        return;
      }
      throw new Error(
        `instance "${args.name}": process group ${pid} survived SIGKILL — refusing to treat it as torn down`,
      );
    })();
    return stopPromise;
  }

  // The device token is read from the instance's own data dir on every call
  // rather than captured once: it is published after listen, and this client is
  // built before the health wait.
  const link = new RPCLink({
    url: `${baseUrl}${RPC_PREFIX}`,
    headers: () => {
      const server = readServerFile(dataDir);
      return server === null ? {} : { authorization: authorizationHeader(server.token) };
    },
  });

  const instance: AppInstance = {
    api: createORPCClient(link),
    baseUrl,
    dataDir,
    vaultDir,
    port,
    name: args.name,
    outputTail,
    stop,
  };
  return { instance, exited: () => exited };
}

async function attemptLaunch(
  args: LaunchAppArgs,
  command: LaunchCommand,
  appDir: string,
  dataDir: string,
  vaultDir: string,
): Promise<AttemptResult> {
  // Dev needs a second port for vite's HMR websocket; both are reserved in
  // one call so the pair is distinct.
  const ports = await reserveFreePorts(args.mode === "dev" ? 2 : 1);
  const port = ports[0];
  if (port === undefined) {
    throw new Error("port reservation returned nothing");
  }
  const { instance, exited } = spawnAttempt(
    args,
    command,
    appDir,
    dataDir,
    vaultDir,
    port,
    ports[1],
  );
  args.register(instance);
  args.onLog(`booting ${args.mode} instance "${args.name}" on ${instance.baseUrl}`);

  const deadline = Date.now() + HEALTH_DEADLINE_MS[args.mode];
  for (;;) {
    if (exited()) {
      const tail = instance.outputTail();
      await instance.stop();
      if (tail.includes("EADDRINUSE")) {
        return { kind: "port-lost", tail };
      }
      throw new Error(`instance "${args.name}" exited before becoming healthy\n${tail}`);
    }
    if (await healthAnswered(instance.baseUrl)) {
      args.onLog(`instance "${args.name}" is healthy`);
      return { kind: "ready", instance };
    }
    if (Date.now() > deadline) {
      const tail = instance.outputTail();
      await instance.stop();
      throw new Error(
        `instance "${args.name}" did not answer ${HEALTH_PATH} within ${HEALTH_DEADLINE_MS[args.mode]}ms\n${tail}`,
      );
    }
    await delay(HEALTH_POLL_INTERVAL_MS);
  }
}

export async function launchApp(args: LaunchAppArgs): Promise<AppInstance> {
  const dataDir = join(args.instanceDir, "data");
  const vaultDir = join(args.instanceDir, "vault");
  await mkdir(dataDir, { recursive: true });

  const appDir = join(args.repoRoot, "apps", "app");
  const command = resolveCommand(args.mode, appDir);

  for (let attempt = 1; ; attempt += 1) {
    const result = await attemptLaunch(args, command, appDir, dataDir, vaultDir);
    if (result.kind === "ready") {
      return result.instance;
    }
    if (attempt >= BOOT_PORT_ATTEMPTS) {
      throw new Error(
        `instance "${args.name}" lost its reserved port ${BOOT_PORT_ATTEMPTS} times in a row\n${result.tail}`,
      );
    }
    args.onLog(`instance "${args.name}" lost its reserved port at bind; retrying with a fresh one`);
  }
}
