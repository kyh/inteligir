// in-process, not supervised: a supervisor buys restart-on-crash at the cost of
// a pid file, a health poll, signal forwarding and two sources of exit code,
// and none of that helps the failure this shape has — a boot that throws.

import { mkdirSync } from "node:fs";
import { resolveUiDir } from "../paths";
import { resolveAgentDriver } from "./agents/agent-driver";
import { resolveCliBinDir, resolveSkillsDir } from "./agents/agent-shell-env";
import { createApp } from "./app";
import { openCloudSocket } from "./cloud/cloud-socket";
import { composeRuntime, registerListener } from "./compose";
import { composeSessionMcpServers } from "./connectors/session-servers";
import { resolveAppConfig } from "./config";
import { ensureDevDataDirOwnership } from "./data-dir";
import { resolveCheckoutRoot } from "./dev-instance";
import { errnoCode } from "./errno";
import { closeServer, listenWithRetry, type UpgradedSockets } from "./listen";
import { createLocalClient } from "./local-client";
import {
  mintServerToken,
  readServerFile,
  removeServerFile,
  writeServerFile,
  type ServerFile,
} from "./server-file";
import {
  createGracefulShutdown,
  installFatalErrorHandlers,
  installShutdownSignals,
  type ShutdownStep,
} from "./shutdown";
import { redactRemoteUrl } from "./vault/git-run";

// passed as env rather than written to process.env: a global write is inherited
// by every child this server spawns (agent shells, the watcher fork).
export interface ServeOverrides {
  INTELIGIR_PORT?: string;
  INTELIGIR_DATA_DIR?: string;
  INTELIGIR_VAULT_DIR?: string;
}

export interface ServeResult {
  serverUrl: string;
  // null when this install ships no UI (an unbuilt checkout).
  uiUrl: string | null;
}

// its own deadline, not the client's: the catch must tell "refused" from "never answered".
const OWNER_PROBE_TIMEOUT_MS = 1_500;

// EPERM is a live process this user may not signal; ESRCH is gone.
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errnoCode(error) === "EPERM";
  }
}

type OwnerProbe =
  | { kind: "answered"; dataDir: string }
  | { kind: "silent" }
  | { kind: "unreachable" };

async function probeOwner(existing: ServerFile): Promise<OwnerProbe> {
  const client = createLocalClient({
    origin: `http://127.0.0.1:${String(existing.port)}`,
    token: existing.token,
    // well past the deadline below, so the client's own abort never fires first.
    timeoutMs: OWNER_PROBE_TIMEOUT_MS * 4,
  });
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort();
  }, OWNER_PROBE_TIMEOUT_MS);
  try {
    const status = await client.system.status(undefined, { signal: deadline.signal });
    return { kind: "answered", dataDir: status.dataDir };
  } catch {
    return deadline.signal.aborted ? { kind: "silent" } : { kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

// silence counts as live: better-sqlite3 is synchronous, so a large batch blocks
// the loop of a server still holding the vault. a refused connection is an
// answer, so an unrelated process that inherited the pid cannot block boot forever.
export async function assertNoLiveServer(dataDir: string): Promise<void> {
  const existing = readServerFile(dataDir);
  if (existing === null) return;
  if (!processAlive(existing.pid)) return;
  const probe = await probeOwner(existing);
  if (probe.kind === "unreachable") return;
  if (probe.kind === "answered" && probe.dataDir !== dataDir) return;
  const what =
    probe.kind === "silent"
      ? `An inteligir server (pid ${String(existing.pid)}) still holds ${dataDir} on port ${String(existing.port)} and is not answering.`
      : `An inteligir server already serves ${dataDir} on port ${String(existing.port)} (pid ${String(existing.pid)}).`;
  throw new Error(`${what} Stop it first, or select another instance with INTELIGIR_DATA_DIR.`);
}

async function boot(
  version: string,
  env: NodeJS.ProcessEnv,
  teardown: ShutdownStep[],
): Promise<ServeResult> {
  const checkoutPath = resolveCheckoutRoot();
  const config = resolveAppConfig({ checkoutPath, env });
  await assertNoLiveServer(config.dataDir);
  mkdirSync(config.dataDir, { recursive: true });
  if (config.mode === "dev" && config.dataDirSource === "default") {
    ensureDevDataDirOwnership(config.dataDir, checkoutPath);
  }

  // published only once the port is bound, so a reader never learns an address before it answers.
  const serverToken = mintServerToken();

  const runtime = await composeRuntime({
    config,
    version,
    teardown,
    // injected: it cannot be imported from the composed graph (cloud/cloud-socket.ts).
    cloudTransport: { openSocket: openCloudSocket },
    driver: ({ config: driverConfig, db, bus, vault, connectors, connectorsOauth, folders }) => {
      const cliBinDir = resolveCliBinDir();
      const skillsDir = resolveSkillsDir();
      return resolveAgentDriver({
        config: driverConfig,
        db,
        notifier: bus,
        vault,
        mcpServers: () => composeSessionMcpServers(connectors, connectorsOauth),
        sessionFacts: () => ({
          dataDir: driverConfig.dataDir,
          cliBinDir,
          skillsDir,
          connectedDirs: folders.list(),
        }),
      });
    },
  });

  const clientDir = resolveUiDir();
  const { app, injectWebSocket } = createApp({
    context: runtime.context,
    bus: runtime.bus,
    voiceStreamHub: runtime.voiceStreamHub,
    serverToken,
    clientDir,
    configuredPort: config.port,
  });

  const { port, server } = await listenWithRetry({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: config.port,
    probeOnBusyPort: config.mode === "dev" && config.portSource === "default",
  });
  // both kinds of upgraded socket detach from the http server's tracking; either would stall server.close().
  const upgradedSockets: UpgradedSockets = {
    closeAllClients: () => {
      runtime.bus.closeAllClients();
      runtime.voiceStreamHub.closeAllClients();
    },
    terminateAllClients: () => {
      runtime.bus.terminateAllClients();
      runtime.voiceStreamHub.terminateAllClients();
    },
  };
  // removed inside the listener step: a row pointing at a closing port is worse than none.
  registerListener(teardown, async () => {
    removeServerFile(config.dataDir);
    await closeServer(server, upgradedSockets);
  });
  // the bound port, never the configured one: a dev port may have been probed upward.
  writeServerFile(config.dataDir, {
    port,
    token: serverToken,
    vaultDir: config.vaultDir,
    pid: process.pid,
  });
  injectWebSocket(server);
  // kicked after listen: an unsettled index only delays the searches that ask for it.
  void runtime.context.knowledge.settle().catch(() => {
    // logged inside the pass; a rebuild that fails again fails the query that needs it.
  });
  const bootRemote = runtime.vaultRemote();
  const agent = runtime.context.system.agent;
  console.log(
    `inteligir ${version} (${config.mode}) listening on http://127.0.0.1:${port} — data: ${config.dataDir} — vault: ${config.vaultDir}${bootRemote === null ? "" : ` ⇄ ${redactRemoteUrl(bootRemote.url)}${bootRemote.source === "paired" ? " (paired)" : ""}`}`,
  );
  console.log(`agent: ${agent.runtime}${agent.detail === null ? "" : ` — ${agent.detail}`}`);
  const serverUrl = `http://127.0.0.1:${port}`;
  return { serverUrl, uiUrl: clientDir === null ? null : `${serverUrl}/` };
}

// both installers go on before the boot, over the live steps array: a ^C during
// a slow first boot tears down what exists, and a fatal mid-boot leaves through
// the same teardown.
export async function runServe(
  version: string,
  overrides: ServeOverrides = {},
): Promise<ServeResult> {
  const teardown: ShutdownStep[] = [];
  const shutdown = createGracefulShutdown({
    steps: teardown,
    onStepFailed: (name, error) => {
      console.error(`shutdown: ${name} failed`, error);
    },
    onTimeout: (deadlineMs) => {
      console.error(`shutdown: still running after ${deadlineMs}ms — exiting anyway`);
    },
  });

  const env = { ...process.env, ...overrides };

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

  installFatalErrorHandlers({
    shutdown,
    target: process,
    onFatal: (event, reason) => {
      console.error(`fatal: ${event} —`, reason);
    },
  });

  const booted = await boot(version, env, teardown).catch(async (cause: unknown) => {
    console.error(
      `inteligir failed to start: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`,
    );
    await shutdown.run();
    // exit, not an exit code: the watcher fork's IPC channel is a live handle, so the loop would never drain.
    process.exit(1);
  });

  return booted;
}
