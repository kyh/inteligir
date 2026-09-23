// in-process, not supervised: a supervisor buys restart-on-crash at the cost of
// a pid file, a health poll, signal forwarding and two sources of exit code,
// and none of that helps the failure this shape has — a boot that throws.

import { mkdirSync } from "node:fs";
import { inspect } from "node:util";
import { browserHandoffUrl } from "@repo/api/local/routes";
import { resolveUiDir } from "../paths";
import { resolveAgentDriver } from "./agents/agent-driver";
import { resolveCliBinDir, resolveSkillsDir } from "./agents/agent-shell-env";
import { createApp } from "./app";
import { openCloudSocket } from "./cloud/cloud-socket";
import { composeRuntime, registerListener, registerLockRelease } from "./compose";
import { composeSessionMcpServers } from "./connectors/session-servers";
import { resolveAppConfig } from "./config";
import { ensureDevDataDirOwnership } from "./data-dir";
import { resolveCheckoutRoot } from "./dev-instance";
import { closeServer, listenWithRetry } from "./listen";
import { createLocalClient } from "./local-client";
import { acquireServeLock, processAlive, serveLockPath } from "./serve-lock";
import {
  LOOPBACK_HOST,
  loopbackOrigin,
  mintServerToken,
  readServerFile,
  removeServerFile,
  writeServerFile,
} from "./server-file";
import type { ServerFile } from "./server-file";
import {
  createGracefulShutdown,
  ignoreDeadStreamErrors,
  installFatalErrorHandlers,
  installShutdownSignals,
} from "./shutdown";
import type { ShutdownStep } from "./shutdown";
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
  // a single-use sign-in for one browser; null when this install ships no UI (an unbuilt checkout).
  uiUrl: string | null;
}

// its own deadline, not the client's: the catch must tell "refused" from "never answered".
const OWNER_PROBE_TIMEOUT_MS = 1500;

type OwnerProbe =
  | { kind: "answered"; dataDir: string }
  | { kind: "silent" }
  | { kind: "unreachable" };

const probeOwner = async (existing: ServerFile): Promise<OwnerProbe> => {
  const client = createLocalClient({
    origin: loopbackOrigin(existing.port),
    // well past the deadline below, so the client's own abort never fires first.
    timeoutMs: OWNER_PROBE_TIMEOUT_MS * 4,
    token: existing.token,
  });
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort();
  }, OWNER_PROBE_TIMEOUT_MS);
  try {
    const status = await client.system.status(undefined, { signal: deadline.signal });
    return { dataDir: status.dataDir, kind: "answered" };
  } catch {
    return deadline.signal.aborted ? { kind: "silent" } : { kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
};

type RowOwner = "serving" | "silent" | "gone";

// silence counts as live: better-sqlite3 is synchronous, so a large batch blocks
// the loop of a server still holding the vault. a refused connection is an
// answer, so an unrelated process that inherited the pid cannot block boot forever.
const judgeRowOwner = async (dataDir: string, row: ServerFile): Promise<RowOwner> => {
  if (!processAlive(row.pid)) {
    return "gone";
  }
  const probe = await probeOwner(row);
  if (probe.kind === "silent") {
    return "silent";
  }
  return probe.kind === "answered" && probe.dataDir === dataDir ? "serving" : "gone";
};

const STOP_IT_FIRST = "Stop it first, or select another instance with INTELIGIR_DATA_DIR.";

export const assertNoLiveServer = async (dataDir: string): Promise<void> => {
  const existing = readServerFile(dataDir);
  if (existing === null) {
    return;
  }
  const owner = await judgeRowOwner(dataDir, existing);
  if (owner === "gone") {
    return;
  }
  const what =
    owner === "silent"
      ? `An inteligir server (pid ${String(existing.pid)}) still holds ${dataDir} on port ${String(existing.port)} and is not answering.`
      : `An inteligir server already serves ${dataDir} on port ${String(existing.port)} (pid ${String(existing.pid)}).`;
  throw new Error(`${what} ${STOP_IT_FIRST}`);
};

// a holder that has published is judged by its row, as the guard judges it, so a lock a crash
// left behind cannot block boot once its pid belongs to something else.
const lockHolderLive = async (dataDir: string, pid: number): Promise<boolean> => {
  if (!processAlive(pid)) {
    return false;
  }
  const row = readServerFile(dataDir);
  // no row of its own yet: a boot still composing.
  if (row === null || row.pid !== pid) {
    return true;
  }
  return (await judgeRowOwner(dataDir, row)) !== "gone";
};

// before anything is composed, and released as the teardown's last step: the guard alone reads a
// row published only after listen, so two boots started together would both pass it.
export const claimDataDir = async (dataDir: string, teardown: ShutdownStep[]): Promise<void> => {
  await assertNoLiveServer(dataDir);
  mkdirSync(dataDir, { recursive: true });
  const claim = await acquireServeLock(dataDir, async (pid) => await lockHolderLive(dataDir, pid));
  if (claim.kind === "held") {
    const holder =
      claim.pid === null
        ? "Another inteligir server"
        : `An inteligir server (pid ${String(claim.pid)})`;
    throw new Error(
      `${holder} already holds ${dataDir}. ${STOP_IT_FIRST} If none is running, delete ${serveLockPath(dataDir)}.`,
    );
  }
  registerLockRelease(teardown, claim.release);
};

const boot = async (
  version: string,
  env: NodeJS.ProcessEnv,
  teardown: ShutdownStep[],
): Promise<ServeResult> => {
  const checkoutPath = resolveCheckoutRoot();
  const config = resolveAppConfig({ checkoutPath, env });
  await claimDataDir(config.dataDir, teardown);
  if (config.mode === "dev" && config.dataDirSource === "default") {
    ensureDevDataDirOwnership(config.dataDir, checkoutPath);
  }

  // published only once the port is bound, so a reader never learns an address before it answers.
  const serverToken = mintServerToken();

  const runtime = await composeRuntime({
    // injected: it cannot be imported from the composed graph (cloud/cloud-socket.ts).
    cloudTransport: { openSocket: openCloudSocket },
    config,
    driver: ({
      config: driverConfig,
      db,
      bus,
      vault,
      connectors,
      connectorsOauth,
      folders,
      agentPrefs,
    }) => {
      const cliBinDir = resolveCliBinDir();
      const skillsDir = resolveSkillsDir();
      return resolveAgentDriver({
        config: driverConfig,
        db,
        mcpServers: async () => await composeSessionMcpServers(connectors, connectorsOauth),
        notifier: bus,
        preferredProviderId: () => agentPrefs.read().defaultHarness ?? null,
        sessionFacts: () => ({
          cliBinDir,
          connectedDirs: folders.list(),
          dataDir: driverConfig.dataDir,
          skillsDir,
        }),
        vault,
      });
    },
    teardown,
    version,
  });

  const clientDir = resolveUiDir();
  const { app, injectWebSocket, upgradedSockets } = createApp({
    bus: runtime.bus,
    clientDir,
    context: runtime.context,
    serverToken,
    voiceStreamHub: runtime.voiceStreamHub,
  });

  const { port, server } = await listenWithRetry({
    fetch: app.fetch,
    hostname: LOOPBACK_HOST,
    port: config.port,
    probeOnBusyPort: config.mode === "dev" && config.portSource === "default",
  });
  // removed inside the listener step: a row pointing at a closing port is worse than none.
  registerListener(teardown, async () => {
    removeServerFile(config.dataDir, serverToken);
    await closeServer(server, upgradedSockets);
  });
  // the bound port, never the configured one: a dev port may have been probed upward.
  writeServerFile(config.dataDir, {
    pid: process.pid,
    port,
    token: serverToken,
    vaultDir: config.vaultDir,
  });
  injectWebSocket(server);
  // kicked after listen: an unsettled index only delays the searches that ask for it.
  void (async () => {
    try {
      await runtime.context.knowledge.settle();
    } catch {
      // logged inside the pass; a rebuild that fails again fails the query that needs it.
    }
  })();
  const bootRemote = runtime.vaultRemote();
  const { agent } = runtime.context.system;
  const serverUrl = loopbackOrigin(port);
  console.log(
    `inteligir ${version} (${config.mode}) listening on ${serverUrl} — data: ${config.dataDir} — vault: ${config.vaultDir}${bootRemote === null ? "" : ` ⇄ ${redactRemoteUrl(bootRemote.url)}${bootRemote.source === "account" ? " (account)" : ""}`}`,
  );
  console.log(`agent: ${agent.runtime}${agent.detail === null ? "" : ` — ${agent.detail}`}`);
  const uiUrl =
    clientDir === null
      ? null
      : browserHandoffUrl(`${serverUrl}/`, runtime.context.browserSession.mintHandoff());
  return { serverUrl, uiUrl };
};

// both installers go on before the boot, over the live steps array: a ^C during
// a slow first boot tears down what exists, and a fatal mid-boot leaves through
// the same teardown.
export const runServe = async (
  version: string,
  overrides: ServeOverrides = {},
): Promise<ServeResult> => {
  const teardown: ShutdownStep[] = [];
  const shutdown = createGracefulShutdown({
    onStepFailed: (name, error) => {
      console.error(`shutdown: ${name} failed`, error);
    },
    onTimeout: (deadlineMs) => {
      console.error(`shutdown: still running after ${deadlineMs}ms — exiting anyway`);
    },
    steps: teardown,
  });

  const env = { ...process.env, ...overrides };

  ignoreDeadStreamErrors([process.stdout, process.stderr]);
  installShutdownSignals({
    onImpatient: (signal) => {
      console.error(`shutdown: ${signal} again — leaving now`);
      process.exit(1);
    },
    onUncleanExit: (failed) => {
      console.error(`shutdown: incomplete — ${failed.join(", ")} did not finish; exiting non-zero`);
    },
    shutdown,
    target: process,
  });

  installFatalErrorHandlers({
    onFatal: (event, reason) => {
      console.error(`fatal: ${event} —`, reason);
    },
    shutdown,
    target: process,
  });

  try {
    return await boot(version, env, teardown);
  } catch (error) {
    // inspect, not the stack: drizzle names the failed query and carries the driver's own error
    // (`no such table: meta`) as the cause, which only the inspection prints.
    console.error(
      `inteligir failed to start: ${error instanceof Error ? inspect(error) : String(error)}`,
    );
    await shutdown.run();
    // exit, not an exit code: the watcher fork's IPC channel is a live handle, so the loop would never drain.
    process.exit(1);
  }
};
