import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { exec, hermeticProcessEnv } from "./exec";
import { bootWithPorts, spawnSupervised } from "./tracked-child";
import type { TrackedProcess } from "./tracked-child";

const READY_POLL_INTERVAL_MS = 250;
// the first boot bundles the whole worker before workerd even starts.
const READY_DEADLINE_MS = 120_000;
const SCHEMA_APPLY_TIMEOUT_MS = 120_000;

// the worker cannot sign sessions without one, and there is no .dev.vars in CI.
const BETTER_AUTH_SECRET = "e2e-better-auth-secret-000000000000";

export const E2E_INVITE_CODE = "E2E-INVITE";

// wrangler.jsonc's `d1_databases[].database_name`.
const D1_DATABASE_NAME = "inteligir-auth";

export interface CloudWorker extends TrackedProcess {
  origin: string;
}

export interface LaunchCloudWorkerArgs {
  repoRoot: string;
  scratchDir: string;
  onLog: (line: string) => void;
  register: (process: TrackedProcess) => void;
  // the vite-emitted dist/server/wrangler.json; its own `main` names the built module, so no
  // positional entry is passed.
  builtConfig?: string;
}

const workerEnv = (): NodeJS.ProcessEnv => {
  const env = hermeticProcessEnv();
  env.WRANGLER_SEND_METRICS = "false";
  return env;
};

const workerAnswered = async (origin: string): Promise<boolean> => {
  try {
    await fetch(`${origin}/api/auth/get-session`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
};

const applySchema = async (
  webDir: string,
  binDir: string,
  args: LaunchCloudWorkerArgs,
  state: {
    stateDir: string;
    configPath: string;
  },
): Promise<void> => {
  args.onLog("deriving the D1 auth schema (apps/web db:export)");
  const ddl = await exec("pnpm", ["run", "--silent", "db:export"], {
    cwd: webDir,
    env: workerEnv(),
    timeoutMs: SCHEMA_APPLY_TIMEOUT_MS,
  });
  const schemaFile = path.join(args.scratchDir, "worker-schema.sql");
  await writeFile(
    schemaFile,
    `${ddl.stdout}\nINSERT INTO invite_code (code) VALUES ('${E2E_INVITE_CODE}');\n`,
    "utf-8",
  );

  args.onLog("applying the schema to the scratch D1");
  await exec(
    path.join(binDir, "wrangler"),
    [
      "d1",
      "execute",
      D1_DATABASE_NAME,
      "--config",
      state.configPath,
      "--local",
      "--persist-to",
      state.stateDir,
      "--file",
      schemaFile,
    ],
    { cwd: webDir, env: workerEnv(), timeoutMs: SCHEMA_APPLY_TIMEOUT_MS },
  );
};

export const launchCloudWorker = async (args: LaunchCloudWorkerArgs): Promise<CloudWorker> => {
  const webDir = path.join(args.repoRoot, "apps", "web");
  const binDir = path.join(webDir, "node_modules", ".bin");
  const stateDir = path.join(args.scratchDir, "worker-state");
  await mkdir(stateDir, { recursive: true });

  // explicit --config everywhere: after a build, .wrangler/deploy/config.json redirects wrangler to
  // dist/server/wrangler.json, whose `no_bundle: true` would hand workerd the raw TypeScript entry.
  const configPath = args.builtConfig ?? path.join(webDir, "wrangler.jsonc");
  await applySchema(webDir, binDir, args, { configPath, stateDir });

  const worker = await bootWithPorts<CloudWorker>({
    deadlineMs: READY_DEADLINE_MS,
    label: "the cloud worker",
    onLog: args.onLog,
    pollIntervalMs: READY_POLL_INTERVAL_MS,
    // the dev server, plus the inspector it always opens.
    portCount: 2,
    ready: async (handle) => await workerAnswered(handle.origin),
    spawn: (ports) => {
      const port = ports[0] ?? 0;
      const inspectorPort = ports[1] ?? 0;
      const child = spawnSupervised({
        argv: [
          "dev",
          // not server.ts: the deployed entry needs TanStack Start's build-time vite virtuals.
          ...(args.builtConfig === undefined ? ["src/worker/index.ts"] : []),
          "--config",
          configPath,
          "--ip",
          "127.0.0.1",
          "--port",
          String(port),
          "--inspector-port",
          String(inspectorPort),
          "--persist-to",
          stateDir,
          "--var",
          `BETTER_AUTH_SECRET:${BETTER_AUTH_SECRET}`,
          // the suite signs up more than one account from one IP.
          "--var",
          "RATE_LIMIT_DISABLED:true",
        ],
        cwd: webDir,
        env: workerEnv(),
        file: path.join(binDir, "wrangler"),
        name: "cloud-worker",
      });
      const handle: CloudWorker = { ...child, origin: `http://127.0.0.1:${String(port)}` };
      args.register(handle);
      args.onLog(`booting the cloud worker on ${handle.origin}`);
      return { child, handle };
    },
  });
  args.onLog("the cloud worker is answering");
  return worker;
};
