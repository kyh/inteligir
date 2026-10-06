import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildProcessEnv, exec, hermeticProcessEnv } from "./exec";
import { bootWithPorts, spawnSupervised } from "./tracked-child";
import type { TrackedProcess } from "./tracked-child";

const READY_POLL_INTERVAL_MS = 250;
// a cold vite build of the whole Worker; a cached one returns at once.
const BUILD_TIMEOUT_MS = 300_000;
const SCHEMA_EXPORT_TIMEOUT_MS = 120_000;
// the host applies the schema on a first Miniflare, then boots the one that listens.
const READY_DEADLINE_MS = 120_000;

// a scenario that boots a Worker: the build, the schema export and a cold boot may each spend their
// whole budget, and two minutes more is the scenario's own work.
export const WORKER_SCENARIO_TIMEOUT_MS =
  BUILD_TIMEOUT_MS + SCHEMA_EXPORT_TIMEOUT_MS + READY_DEADLINE_MS + 120_000;

// the worker cannot sign sessions without one, and there is no .dev.vars in CI.
const BETTER_AUTH_SECRET = "e2e-better-auth-secret-000000000000";

export const E2E_INVITE_CODE = "E2E-INVITE";

export interface CloudWorker extends TrackedProcess {
  origin: string;
}

export interface LaunchCloudWorkerArgs {
  repoRoot: string;
  scratchDir: string;
  onLog: (line: string) => void;
  register: (process: TrackedProcess) => void;
  // over cloudflare.config.ts's own text bindings, such as a storage cap a scenario can fill
  vars?: Readonly<Record<string, string>>;
}

const workerAnswered = async (origin: string): Promise<boolean> => {
  try {
    await fetch(`${origin}/api/auth/get-session`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
};

// the Worker that deploys, not its source: built through turbo rather than looked for on disk, as a
// present artifact may be stale and boot last week's Worker.
const buildWorker = async (args: LaunchCloudWorkerArgs): Promise<void> => {
  args.onLog("building the Worker (turbo, @repo/web)");
  await exec("pnpm", ["turbo", "run", "build", "--filter=@repo/web"], {
    cwd: args.repoRoot,
    env: buildProcessEnv(),
    timeoutMs: BUILD_TIMEOUT_MS,
  });
};

const writeSchema = async (webDir: string, args: LaunchCloudWorkerArgs): Promise<string> => {
  args.onLog("deriving the D1 auth schema (apps/web db:export)");
  const ddl = await exec("pnpm", ["run", "--silent", "db:export"], {
    cwd: webDir,
    env: hermeticProcessEnv(),
    timeoutMs: SCHEMA_EXPORT_TIMEOUT_MS,
  });
  const schemaFile = path.join(args.scratchDir, "worker-schema.sql");
  await writeFile(
    schemaFile,
    `${ddl.stdout}\nINSERT INTO invite_code (code) VALUES ('${E2E_INVITE_CODE}');\n`,
    "utf-8",
  );
  return schemaFile;
};

export const launchCloudWorker = async (args: LaunchCloudWorkerArgs): Promise<CloudWorker> => {
  const webDir = path.join(args.repoRoot, "apps", "web");
  const e2eDir = path.join(args.repoRoot, "tools", "e2e");
  const stateDir = path.join(args.scratchDir, "worker-state");
  await mkdir(stateDir, { recursive: true });

  await buildWorker(args);
  const schemaFile = await writeSchema(webDir, args);

  const worker = await bootWithPorts<CloudWorker>({
    deadlineMs: READY_DEADLINE_MS,
    label: "the cloud worker",
    onLog: args.onLog,
    pollIntervalMs: READY_POLL_INTERVAL_MS,
    // the Worker, plus the inspector it always opens.
    portCount: 2,
    ready: async (handle) => await workerAnswered(handle.origin),
    spawn: (ports) => {
      const port = ports[0] ?? 0;
      const inspectorPort = ports[1] ?? 0;
      const child = spawnSupervised({
        argv: [
          path.join(e2eDir, "src", "harness", "worker-host.ts"),
          JSON.stringify({
            inspectorPort,
            outputDir: path.join(webDir, ".cloudflare", "output", "v0", "workers", "default"),
            port,
            schemaFile,
            stateDir,
            vars: {
              BETTER_AUTH_SECRET,
              // the suite signs up more than one account from one IP.
              RATE_LIMIT_DISABLED: "true",
              ...args.vars,
            },
          }),
        ],
        cwd: e2eDir,
        env: hermeticProcessEnv(),
        file: path.join(e2eDir, "node_modules", ".bin", "tsx"),
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
