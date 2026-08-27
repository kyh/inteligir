// Boots the product Worker (apps/web) as a local `wrangler dev` process, for
// the scenarios that need the REAL cloud: real workerd, real D1, real
// durable-git repo cells under a scratch persist dir.
//
// The D1 auth schema is applied BEFORE the worker boots, derived the same way
// the worker's own vitest config derives it — `drizzle-kit export` over
// src/worker/db/schema.ts — plus one invite row, because sign-up is
// invite-gated and this suite signs up for real. The entry is
// src/worker/index.ts, the same override that vitest config uses: the
// deployed entry (src/worker/server.ts) needs TanStack Start's build-time
// vite virtuals, and the scenarios exercise the API surface, so they enter
// where it starts.

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { exec, hermeticProcessEnv } from "./exec";
import { reserveFreePorts } from "./ports";
import { stopProcessGroup, trackLiveGroup } from "./process-group";
import type { TrackedProcess } from "./scenario";

const READY_POLL_INTERVAL_MS = 250;
/** Generous: the first boot bundles the whole worker (durable-git included)
 *  before workerd even starts. */
const READY_DEADLINE_MS = 120_000;
const SCHEMA_APPLY_TIMEOUT_MS = 120_000;
/** Bound on losing the reserve→bind race — wrangler bundles for seconds
 *  before it binds, so the window is wider than an instance's. */
const BOOT_PORT_ATTEMPTS = 3;

/** Deterministic dev-only value — the worker cannot sign sessions without
 *  one, and there is no .dev.vars in CI. */
const BETTER_AUTH_SECRET = "e2e-better-auth-secret-000000000000";

/** The one invite row the schema apply inserts; sign-up is invite-gated and
 *  this suite signs up through the production route. */
export const E2E_INVITE_CODE = "E2E-INVITE";

/** wrangler.jsonc's `d1_databases[].database_name` — what `d1 execute`
 *  addresses. */
const D1_DATABASE_NAME = "inteligir-auth";

export interface CloudWorker extends TrackedProcess {
  /** `http://127.0.0.1:<port>` — what INTELIGIR_CLOUD_URL points at. */
  origin: string;
}

export interface LaunchCloudWorkerArgs {
  repoRoot: string;
  /** The scenario's scratch dir; the worker's persist state lives inside. */
  scratchDir: string;
  onLog: (line: string) => void;
  /** Called at SPAWN, before the ready wait — the runner's teardown then
   *  owns the process group through every early-exit path, counts a stop
   *  failure in `teardownClean`, and prints the tail on failure. */
  track: (process: TrackedProcess) => void;
}

function workerEnv(): NodeJS.ProcessEnv {
  const env = hermeticProcessEnv();
  env.WRANGLER_SEND_METRICS = "false";
  return env;
}

/** Ready means "workerd answered an HTTP request at all" — the schema was
 *  applied before boot, so the first real request is already meaningful. */
async function workerAnswered(origin: string): Promise<boolean> {
  try {
    await fetch(`${origin}/api/auth/get-session`, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

interface BootPaths {
  webDir: string;
  binDir: string;
  stateDir: string;
  configPath: string;
}

type BootAttempt =
  /** The reserved port was taken between reserve and bind; retry fresh. */
  { kind: "port-lost"; tail: string } | { kind: "ready"; worker: CloudWorker };

async function attemptBoot(args: LaunchCloudWorkerArgs, paths: BootPaths): Promise<BootAttempt> {
  const ports = await reserveFreePorts(2);
  const port = ports[0];
  const inspectorPort = ports[1];
  if (port === undefined || inspectorPort === undefined) {
    throw new Error("port reservation returned nothing");
  }
  const origin = `http://127.0.0.1:${port}`;

  // Its own process group, so stop() can kill the whole tree — wrangler
  // forks workerd, which must not outlive it.
  const child = spawn(
    join(paths.binDir, "wrangler"),
    [
      "dev",
      "src/worker/index.ts",
      "--config",
      paths.configPath,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
      "--persist-to",
      paths.stateDir,
      "--var",
      `BETTER_AUTH_SECRET:${BETTER_AUTH_SECRET}`,
      // The suite signs up more than one account from one IP; rate limiting
      // is covered by the worker's own vitest.
      "--var",
      "RATE_LIMIT_DISABLED:true",
    ],
    {
      cwd: paths.webDir,
      detached: true,
      env: workerEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const pid = child.pid;
  if (pid !== undefined) {
    trackLiveGroup(pid);
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
    consume(stdout, "worker");
  }
  if (stderr !== null) {
    consume(stderr, "worker!");
  }

  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  child.once("error", (error) => {
    outputLines.push(`[worker!] spawn error: ${error.message}`);
    exited = true;
  });

  function outputTail(lines = 40): string {
    return outputLines.slice(-lines).join("\n");
  }

  let stopPromise: Promise<void> | null = null;
  function stop(): Promise<void> {
    stopPromise ??= pid === undefined ? Promise.resolve() : stopProcessGroup(pid, "cloud worker");
    return stopPromise;
  }

  const worker: CloudWorker = { name: "cloud-worker", origin, outputTail, stop };
  args.track(worker);
  args.onLog(`booting the cloud worker on ${origin}`);

  const deadline = Date.now() + READY_DEADLINE_MS;
  for (;;) {
    if (exited) {
      const tail = outputTail();
      await stop();
      if (tail.includes("Address already in use") || tail.includes("EADDRINUSE")) {
        return { kind: "port-lost", tail };
      }
      throw new Error(`the cloud worker exited before answering\n${tail}`);
    }
    if (await workerAnswered(origin)) {
      args.onLog("the cloud worker is answering");
      return { kind: "ready", worker };
    }
    if (Date.now() > deadline) {
      const tail = outputTail();
      await stop();
      throw new Error(`the cloud worker did not answer within ${READY_DEADLINE_MS}ms\n${tail}`);
    }
    await delay(READY_POLL_INTERVAL_MS);
  }
}

export async function launchCloudWorker(args: LaunchCloudWorkerArgs): Promise<CloudWorker> {
  const webDir = join(args.repoRoot, "apps", "web");
  const binDir = join(webDir, "node_modules", ".bin");
  const stateDir = join(args.scratchDir, "worker-state");
  await mkdir(stateDir, { recursive: true });

  args.onLog("deriving the D1 auth schema (drizzle-kit export)");
  const ddl = await exec(
    join(binDir, "drizzle-kit"),
    ["export", "--dialect=sqlite", `--schema=${join(webDir, "src/worker/db/schema.ts")}`],
    { cwd: webDir, env: workerEnv(), timeoutMs: SCHEMA_APPLY_TIMEOUT_MS },
  );
  const schemaFile = join(args.scratchDir, "worker-schema.sql");
  await writeFile(
    schemaFile,
    `${ddl.stdout}\nINSERT INTO invite_code (code) VALUES ('${E2E_INVITE_CODE}');\n`,
    "utf8",
  );

  // An EXPLICIT --config everywhere: after a build, .wrangler/deploy/config.json
  // redirects wrangler to dist/server/wrangler.json — whose `no_bundle: true`
  // would hand workerd the raw TypeScript entry. Naming the source config is
  // what an explicit path turns off (resolveWranglerConfigPath skips the
  // redirect when one is given).
  const configPath = join(webDir, "wrangler.jsonc");

  args.onLog("applying the schema to the scratch D1");
  await exec(
    join(binDir, "wrangler"),
    [
      "d1",
      "execute",
      D1_DATABASE_NAME,
      "--config",
      configPath,
      "--local",
      "--persist-to",
      stateDir,
      "--file",
      schemaFile,
    ],
    { cwd: webDir, env: workerEnv(), timeoutMs: SCHEMA_APPLY_TIMEOUT_MS },
  );

  const paths: BootPaths = { webDir, binDir, stateDir, configPath };
  for (let attempt = 1; ; attempt += 1) {
    const result = await attemptBoot(args, paths);
    if (result.kind === "ready") {
      return result.worker;
    }
    if (attempt >= BOOT_PORT_ATTEMPTS) {
      throw new Error(
        `the cloud worker lost its reserved port ${String(BOOT_PORT_ATTEMPTS)} times in a row\n${result.tail}`,
      );
    }
    args.onLog("the cloud worker lost its reserved port at bind; retrying with a fresh one");
  }
}
