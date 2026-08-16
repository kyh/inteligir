// Boots ONE real app process on a scratch instance dir (data/ and vault/ as
// siblings — the app refuses nesting) and hands back the typed API client.
// Dev mode runs the same entry `pnpm dev` runs (tsx + vite middleware); prod
// mode runs the built bundle (`dist-node/main.js`) under plain node.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createApiClient, type ApiClient } from "@repo/server-contract/client";
import { hermeticGitEnv } from "./exec";
import { reserveFreePort } from "./ports";

export type BootMode = "dev" | "prod";

const HEALTH_POLL_INTERVAL_MS = 250;
/** Dev pays a vite cold start; prod is a plain node boot. */
const HEALTH_DEADLINE_MS: Record<BootMode, number> = { dev: 120_000, prod: 30_000 };
const STOP_SIGTERM_GRACE_MS = 5_000;
const STOP_SIGKILL_GRACE_MS = 2_000;

export interface LaunchAppArgs {
  mode: BootMode;
  /** Short label for transcript lines ("a", "b", "solo"). */
  name: string;
  /** Scratch dir owned by this instance; data/ and vault/ are created inside. */
  instanceDir: string;
  repoRoot: string;
  /** Git remote URL for the vault sync loop; omitted = local-only. */
  vaultRemote?: string;
  /** Extra child env (e.g. the scripted-agent contract). */
  extraEnv?: Readonly<Record<string, string>>;
  onLog: (line: string) => void;
}

export interface AppInstance {
  api: ApiClient;
  baseUrl: string;
  dataDir: string;
  vaultDir: string;
  port: number;
  name: string;
  /** The child's interleaved stdout+stderr tail, for failure transcripts. */
  outputTail(lines?: number): string;
  stop(): Promise<void>;
}

function buildChildEnv(args: LaunchAppArgs, dataDir: string, vaultDir: string, port: number) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...hermeticGitEnv() };
  // The outer shell's own overrides must never leak into an instance.
  delete env.INTELIGIR_DATA_DIR;
  delete env.INTELIGIR_PORT;
  delete env.INTELIGIR_VAULT_DIR;
  delete env.INTELIGIR_VAULT_REMOTE;
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
  }
  Object.assign(env, args.extraEnv ?? {});
  return env;
}

function resolveCommand(mode: BootMode, appDir: string): { file: string; argv: string[] } {
  if (mode === "dev") {
    return {
      file: join(appDir, "node_modules", ".bin", "tsx"),
      argv: [join(appDir, "src", "node", "main.ts")],
    };
  }
  const bundle = join(appDir, "dist-node", "main.js");
  const shell = join(appDir, "dist", "client", "_shell.html");
  if (!existsSync(bundle) || !existsSync(shell)) {
    throw new Error(
      `prod mode needs the built app (missing ${existsSync(bundle) ? shell : bundle}); run: pnpm --filter @repo/app build`,
    );
  }
  return { file: process.execPath, argv: [bundle] };
}

export async function launchApp(args: LaunchAppArgs): Promise<AppInstance> {
  const dataDir = join(args.instanceDir, "data");
  const vaultDir = join(args.instanceDir, "vault");
  await mkdir(dataDir, { recursive: true });

  const appDir = join(args.repoRoot, "apps", "app");
  const command = resolveCommand(args.mode, appDir);
  const port = await reserveFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  // Its own process group, so stop() can kill the whole tree — the dev entry
  // forks a watcher child that would otherwise outlive its parent.
  const child = spawn(command.file, command.argv, {
    cwd: appDir,
    detached: true,
    env: buildChildEnv(args, dataDir, vaultDir, port),
    stdio: ["ignore", "pipe", "pipe"],
  });

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
  const exitPromise = new Promise<void>((resolve) => {
    child.once("exit", () => {
      exited = true;
      resolve();
    });
    child.once("error", (error) => {
      outputLines.push(`[${args.name}!] spawn error: ${error.message}`);
      exited = true;
      resolve();
    });
  });

  function outputTail(lines = 40): string {
    return outputLines.slice(-lines).join("\n");
  }

  function killGroup(signal: NodeJS.Signals): void {
    const pid = child.pid;
    if (pid === undefined) {
      return;
    }
    try {
      process.kill(-pid, signal);
    } catch {
      // The group is already gone; fall back to the direct child just in case.
      try {
        child.kill(signal);
      } catch {
        // Already dead.
      }
    }
  }

  let stopPromise: Promise<void> | null = null;
  function stop(): Promise<void> {
    stopPromise ??= (async () => {
      if (!exited) {
        killGroup("SIGTERM");
        await Promise.race([exitPromise, delay(STOP_SIGTERM_GRACE_MS)]);
      }
      if (!exited) {
        killGroup("SIGKILL");
        await Promise.race([exitPromise, delay(STOP_SIGKILL_GRACE_MS)]);
      }
    })();
    return stopPromise;
  }

  args.onLog(`booting ${args.mode} instance "${args.name}" on ${baseUrl}`);
  const deadline = Date.now() + HEALTH_DEADLINE_MS[args.mode];
  for (;;) {
    if (exited) {
      throw new Error(`instance "${args.name}" exited before becoming healthy\n${outputTail()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        break;
      }
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(
        `instance "${args.name}" did not answer /api/v1/health within ${HEALTH_DEADLINE_MS[args.mode]}ms\n${outputTail()}`,
      );
    }
    await delay(HEALTH_POLL_INTERVAL_MS);
  }
  args.onLog(`instance "${args.name}" is healthy`);

  return {
    api: createApiClient(baseUrl),
    baseUrl,
    dataDir,
    vaultDir,
    port,
    name: args.name,
    outputTail,
    stop,
  };
}
