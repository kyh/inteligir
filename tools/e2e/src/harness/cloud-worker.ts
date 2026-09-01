// Boots the product Worker (apps/web) as a local `wrangler dev` process, for
// the scenarios that need the REAL cloud: real workerd, real D1, real
// durable-git repo cells under a scratch persist dir.
//
// The D1 auth schema is applied BEFORE the worker boots, through apps/web's
// own `db:export` script — the same one its vitest config runs, so the DDL
// under test and the DDL here cannot be two recipes — plus one invite row,
// because sign-up is invite-gated and this suite signs up for real.
//
// The entry is src/worker/index.ts, the same override that vitest config
// uses: the deployed entry (src/worker/server.ts) needs TanStack Start's
// build-time vite virtuals, and the scenarios exercise the API surface, so
// they enter where it starts.
//
// The child-process half is `tracked-child.ts`, shared with app instances.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exec, hermeticProcessEnv } from "./exec";
import { bootWithPorts, spawnSupervised, type TrackedProcess } from "./tracked-child";

const READY_POLL_INTERVAL_MS = 250;
/** Generous: the first boot bundles the whole worker (durable-git included)
 *  before workerd even starts. */
const READY_DEADLINE_MS = 120_000;
const SCHEMA_APPLY_TIMEOUT_MS = 120_000;

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
  /** The runner's teardown registry, handed the worker at SPAWN. */
  register: (process: TrackedProcess) => void;
  /** Boot the vite-EMITTED config (dist/server/wrangler.json) instead of the
   *  source entry — the deploy artifact itself, bundle and all. No positional
   *  entry is passed then: the emitted config's own `main` names the built
   *  module, which is the thing under test. */
  builtConfig?: string;
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

/** The scratch D1, carrying apps/web's own schema and this suite's invite. */
async function applySchema(
  webDir: string,
  binDir: string,
  args: LaunchCloudWorkerArgs,
  state: {
    stateDir: string;
    configPath: string;
  },
): Promise<void> {
  args.onLog("deriving the D1 auth schema (apps/web db:export)");
  const ddl = await exec("pnpm", ["run", "--silent", "db:export"], {
    cwd: webDir,
    env: workerEnv(),
    timeoutMs: SCHEMA_APPLY_TIMEOUT_MS,
  });
  const schemaFile = join(args.scratchDir, "worker-schema.sql");
  await writeFile(
    schemaFile,
    `${ddl.stdout}\nINSERT INTO invite_code (code) VALUES ('${E2E_INVITE_CODE}');\n`,
    "utf8",
  );

  args.onLog("applying the schema to the scratch D1");
  await exec(
    join(binDir, "wrangler"),
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
}

export async function launchCloudWorker(args: LaunchCloudWorkerArgs): Promise<CloudWorker> {
  const webDir = join(args.repoRoot, "apps", "web");
  const binDir = join(webDir, "node_modules", ".bin");
  const stateDir = join(args.scratchDir, "worker-state");
  await mkdir(stateDir, { recursive: true });

  // An EXPLICIT --config everywhere: after a build, .wrangler/deploy/config.json
  // redirects wrangler to dist/server/wrangler.json — whose `no_bundle: true`
  // would hand workerd the raw TypeScript entry. An explicit path is what
  // turns the redirect off (resolveWranglerConfigPath skips it when one is
  // given): the source config by default, or the emitted config itself when
  // the caller asked for the BUILT bundle.
  const configPath = args.builtConfig ?? join(webDir, "wrangler.jsonc");
  await applySchema(webDir, binDir, args, { stateDir, configPath });

  const worker = await bootWithPorts<CloudWorker>({
    label: "the cloud worker",
    // The dev server, plus the inspector it always opens.
    portCount: 2,
    deadlineMs: READY_DEADLINE_MS,
    pollIntervalMs: READY_POLL_INTERVAL_MS,
    onLog: args.onLog,
    spawn: (ports) => {
      const port = ports[0] ?? 0;
      const inspectorPort = ports[1] ?? 0;
      const child = spawnSupervised({
        name: "cloud-worker",
        file: join(binDir, "wrangler"),
        argv: [
          "dev",
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
          // The suite signs up more than one account from one IP; rate
          // limiting is covered by the worker's own vitest.
          "--var",
          "RATE_LIMIT_DISABLED:true",
        ],
        cwd: webDir,
        env: workerEnv(),
      });
      const handle: CloudWorker = { ...child, origin: `http://127.0.0.1:${String(port)}` };
      args.register(handle);
      args.onLog(`booting the cloud worker on ${handle.origin}`);
      return { handle, child };
    },
    ready: (handle) => workerAnswered(handle.origin),
  });
  args.onLog("the cloud worker is answering");
  return worker;
}
