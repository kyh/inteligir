// The shipping process. Boot order: config → db open+migrate → createApp →
// serve → injectWebSocket. Dev mounts Vite in middlewareMode as the fallback
// (one process, HMR untouched); prod serves dist/client and the Start server
// entry's fetch.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { closeConnection, createConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import { runMigrations } from "@repo/db/migrate";
import { z } from "zod";
import { resolveAgentDriver } from "./agent/agent-driver";
import { buildAgentShellEnv, resolveCliBinDir } from "./agent/agent-shell-env";
import { createApp, type AppFallback, type StartFetchOptions } from "./app";
import { openCloudSocket } from "./cloud/cloud-socket";
import { resolveAppConfig } from "./config";
import { ensureDevDataDirOwnership } from "./data-dir";
import { ensureInstanceSecret } from "./instance-identity";
import { createKnowledgeRuntime, type KnowledgeRuntime } from "./knowledge/knowledge-runtime";
import { closeServer, listenWithRetry } from "./listen";
import { createTurnProposalCapture } from "./proposals/turn-proposals";
import {
  createGracefulShutdown,
  installFatalErrorHandlers,
  installShutdownSignals,
  TEARDOWN_BUDGETS_MS,
  type ShutdownStep,
  type TeardownStepName,
} from "./shutdown";
import { redactRemoteUrl } from "./vault/git";
import { createVaultRuntime } from "./vault/vault-runtime";
import { WsBus } from "./ws-bus";

interface EntryLayout {
  /** The app directory (where package.json and dist/ live). */
  appDirUrl: URL;
  /** Set only for the bundle, which carries its own migrations copy. */
  migrationsFolder?: string;
}

/**
 * The layout this entry runs in: src/node/main.ts under tsx (the app dir is
 * two levels up, migrations come from @repo/db's own source-adjacent default)
 * or dist-node/main.js as the prod bundle (one level up, with the committed
 * migrations copied beside the entry by scripts/build-node-entry.mjs).
 */
function resolveEntryLayout(): EntryLayout {
  const sourceAppDir = new URL("../../", import.meta.url);
  if (existsSync(fileURLToPath(new URL("package.json", sourceAppDir)))) {
    return { appDirUrl: sourceAppDir };
  }
  const bundleAppDir = new URL("../", import.meta.url);
  if (existsSync(fileURLToPath(new URL("package.json", bundleAppDir)))) {
    return {
      appDirUrl: bundleAppDir,
      migrationsFolder: fileURLToPath(new URL("drizzle", import.meta.url)),
    };
  }
  throw new Error("cannot locate the app directory: no package.json beside the entry");
}

const { appDirUrl, migrationsFolder } = resolveEntryLayout();

function readAppVersion(): string {
  const raw = readFileSync(new URL("package.json", appDirUrl), "utf8");
  return z.object({ version: z.string().min(1) }).parse(JSON.parse(raw)).version;
}

async function createDevFallback(hmrPort: number): Promise<AppFallback> {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: fileURLToPath(appDirUrl),
    // `ws.port` moves BOTH halves — the standalone HMR ws server and the
    // port injected into @vite/client — so the pair stays matched. (`ws:
    // false` is not enough: it stops the server while the injected client
    // still dials, and every page load throws.)
    server: { middlewareMode: true, ws: { port: hmrPort } },
  });
  return { kind: "dev", middlewares: vite.middlewares };
}

function extractStartFetch(
  entryModule: unknown,
  entryPath: string,
): (request: Request, options: StartFetchOptions) => Promise<Response> {
  if (typeof entryModule !== "object" || entryModule === null || !("default" in entryModule)) {
    throw new Error(`${entryPath} has no default export`);
  }
  const entry = entryModule.default;
  if (typeof entry !== "object" || entry === null || !("fetch" in entry)) {
    throw new Error(`${entryPath} default export has no fetch member`);
  }
  const fetchMember = entry.fetch;
  if (typeof fetchMember !== "function") {
    throw new Error(`${entryPath} default.fetch is not a function`);
  }
  return async (request, options) => {
    const response: unknown = await fetchMember.call(entry, request, options);
    if (!(response instanceof Response)) {
      throw new Error(`${entryPath} fetch did not return a Response`);
    }
    return response;
  };
}

async function createProdFallback(): Promise<AppFallback> {
  const clientDir = fileURLToPath(new URL("dist/client", appDirUrl));
  const entryPath = fileURLToPath(new URL("dist/server/server.js", appDirUrl));
  const entryModule: unknown = await import(pathToFileURL(entryPath).href);
  return {
    kind: "prod",
    clientDir,
    startFetch: extractStartFetch(entryModule, entryPath),
  };
}

/**
 * The teardown, accumulated AS THE BOOT PROCEEDS.
 *
 * `unshift` rather than `push`, and the two orders coincide on purpose:
 * resources come up db → vault → knowledge → agent → cloud → listener, so
 * reversing creation yields exactly the teardown order shutdown.ts states
 * (listener → cloud → agent → knowledge → vault → db). Registering each step
 * the moment its resource exists is also what makes a FAILED boot survivable:
 * a listen that
 * throws EADDRINUSE still has a vault watcher forked and a database open, and
 * without this the process would sit there holding both, alive on the
 * watcher's IPC channel and listening to nothing.
 */
const teardownSteps: ShutdownStep[] = [];
function registerTeardown(name: TeardownStepName, run: () => Promise<void>): void {
  teardownSteps.unshift({ name, timeoutMs: TEARDOWN_BUDGETS_MS[name], run });
}

async function boot(): Promise<{ serverUrl: string }> {
  const checkoutPath = process.cwd();
  const config = resolveAppConfig({ checkoutPath, env: process.env });
  mkdirSync(config.dataDir, { recursive: true });
  if (config.mode === "dev" && config.dataDirSource === "default") {
    ensureDevDataDirOwnership(config.dataDir, checkoutPath);
  }

  // Kicked off before the synchronous db open + migrate so the Vite / Start
  // module loads overlap them; awaited once the db is ready.
  const fallbackPromise =
    config.mode === "dev" ? createDevFallback(config.devHmrPort) : createProdFallback();

  const db = createConnection(config.databasePath);
  registerTeardown("db", async () => {
    closeConnection(db);
  });
  const schemaVersion = getSchemaVersion(db, runMigrations(db, migrationsFolder));

  const version = readAppVersion();
  // Written before the listener opens, so anything that can reach the health
  // route can also be asked to prove it owns this data dir.
  const instanceSecret = ensureInstanceSecret(config.dataDir);
  const bus = new WsBus({ version });
  // The knowledge runtime needs the vault service the runtime hands back, so
  // the hook late-binds; changes before it exists are covered by the boot
  // reconcile the first pass always runs.
  let knowledgeRef: KnowledgeRuntime | null = null;
  const vault = await createVaultRuntime({
    vaultDir: config.vaultDir,
    vaultRemote: config.vaultRemote,
    dataDir: config.dataDir,
    notifier: bus,
    onFilesChanged: (change) => knowledgeRef?.noteVaultChange(change),
    ...(config.vaultSyncIntervalMs === undefined
      ? {}
      : { syncIntervalMs: config.vaultSyncIntervalMs }),
  });
  registerTeardown("vault", () => vault.dispose());
  const knowledge = createKnowledgeRuntime({
    dataDir: config.dataDir,
    vault: vault.service,
    vaultRoot: config.vaultDir,
  });
  registerTeardown("knowledge", () => knowledge.dispose());
  knowledgeRef = knowledge;
  const fallback = await fallbackPromise;

  // Filled in after listen (the bound port may be a probed one); read lazily by
  // the codex runtime on the first turn, which an HTTP request precedes.
  let agentShellEnv: Record<string, string> = {};
  const cliBinDir = resolveCliBinDir();
  const agentDriver = resolveAgentDriver({
    config,
    db,
    notifier: bus,
    vault,
    cliBinDir,
    captureProposals: createTurnProposalCapture({
      db,
      notifier: bus,
      git: vault.git,
      vault: vault.service,
      onDebug: (message) => {
        console.error(`proposals: ${message}`);
      },
    }),
    shellEnv: () => ({ ...agentShellEnv }),
  });
  registerTeardown("agent", () => agentDriver.dispose());

  const { app, cloud, injectWebSocket } = createApp({
    agent: agentDriver.status,
    bus,
    // The real dial, injected because it cannot be imported from `app.ts` —
    // see `cloud/cloud-socket.ts`. This is the ONE place that supplies it.
    cloudTransport: { openSocket: openCloudSocket },
    config,
    createTurnDriver: agentDriver.createTurnDriver,
    db,
    fallback,
    instanceSecret,
    knowledge,
    schemaVersion,
    startedAt: Date.now(),
    vault,
    version,
  });
  registerTeardown("cloud", () => cloud.dispose());

  const { port, server } = await listenWithRetry({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: config.port,
    probeOnBusyPort: config.mode === "dev" && config.portSource === "default",
  });
  registerTeardown("listener", () => closeServer(server, bus));
  injectWebSocket(server);
  // Nothing ever scheduled the boot pass, so the hydrate-and-reconcile landed
  // in front of whichever query settled first — the user's first ⌘K. Kicked
  // here rather than before `listen`, because it is not what the port waits on:
  // an unsettled index only delays the searches that ask for it.
  void knowledge.settle().catch(() => {
    // Logged inside the pass; a rebuild that fails again fails the query that
    // needs it, and boot is not that query.
  });
  agentShellEnv = buildAgentShellEnv({
    serverUrl: `http://127.0.0.1:${port}`,
    env: process.env,
    cliBinDir,
  });
  console.log(
    `inteligir ${version} (${config.mode}) listening on http://127.0.0.1:${port} — data: ${config.dataDir} — vault: ${config.vaultDir}${config.vaultRemote === null ? "" : ` ⇄ ${redactRemoteUrl(config.vaultRemote)}`}`,
  );
  console.log(
    `agent: ${agentDriver.status.runtime}${agentDriver.status.detail === null ? "" : ` — ${agentDriver.status.detail}`}`,
  );
  return { serverUrl: `http://127.0.0.1:${port}` };
}

const shutdown = createGracefulShutdown({
  steps: teardownSteps,
  onStepFailed: (name, error) => {
    console.error(`shutdown: ${name} failed`, error);
  },
  onTimeout: (deadlineMs) => {
    console.error(`shutdown: still running after ${deadlineMs}ms — exiting anyway`);
  },
});

// Installed BEFORE the boot, so a ^C during a slow first boot (a cold vault
// reconcile, a clone) tears down what exists instead of being ignored.
installShutdownSignals({
  shutdown,
  target: process,
  onImpatient: (signal) => {
    console.error(`shutdown: ${signal} again — leaving now`);
    process.exit(1);
  },
  onUncleanExit: (failed) => {
    console.error(`shutdown: incomplete — ${failed.join(", ")} did not finish; exiting non-zero`);
  },
});

const booted = await boot().catch(async (error: unknown) => {
  console.error(
    `inteligir failed to start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  // Whatever came up must come down, or the process lives on inside the
  // watcher fork's IPC channel with nothing listening.
  await shutdown.run();
  process.exit(1);
});

installFatalErrorHandlers({
  shutdown,
  target: process,
  onFatal: (event, reason) => {
    console.error(`fatal: ${event} —`, reason);
  },
});

/** The URL this process ended up on, for an in-process launcher that has to
 *  know the bound port (it may have been probed) to print and open it. */
export const serverUrl = booted.serverUrl;
